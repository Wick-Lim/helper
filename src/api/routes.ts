// API route handlers

import { runAgent } from "../agent/agent.js";
import { registry } from "../tools/registry.js";
import * as tasks from "../db/tasks.js";
import * as config from "../db/config.js";
import { DEFAULTS } from "../db/config.js";
import * as memory from "../db/memory.js";
import { getLLM, getCorsHeaders } from "./server.js";
import { getAllApiUsage } from "../core/ratelimit.js";
import { getBrowserStats } from "../tools/browser.js";
import { logger } from "../core/logger.js";
import { getSurvivalStats } from "../db/survival.ts";
import { getRecentThoughts, getTimeline } from "../db/growth.ts";
import { interruptLoop } from "../agent/consciousness.ts";
import { INSTANCE_ID } from "../index.js";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { EventEmitter } from "events";
import type { AgentEvent } from "../core/types.js";

const MAX_CONCURRENT_CHATS = 3;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SCREENSHOT_DIR = "/data/screenshots";

// SSE Event Emitters (global) - exported for use in other modules
export const timelineEvents = new EventEmitter();
export const thoughtsEvents = new EventEmitter();
export const tasksEvents = new EventEmitter();

// Emit heartbeats to keep connections alive
setInterval(() => {
  timelineEvents.emit("sse", ": heartbeat\n\n");
  thoughtsEvents.emit("sse", ": heartbeat\n\n");
  tasksEvents.emit("sse", ": heartbeat\n\n");
}, 15000);

let activeChatCount = 0;

export function getActiveChatCount(): number {
  return activeChatCount;
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Strip base64 image data, replace with serving URL */
function sanitizeEvent(event: AgentEvent): Record<string, unknown> {
  if (event.type === "tool_result" && event.result.images?.length) {
    const sanitizedImages = event.result.images.map((img) => ({
      mimeType: img.mimeType,
      size: Math.ceil((img.data.length * 3) / 4),
      url: img.id ? `/api/images/${img.id}` : undefined,
    }));
    return {
      type: event.type,
      name: event.name,
      result: {
        success: event.result.success,
        output: event.result.output,
        error: event.result.error,
        executionTime: event.result.executionTime,
        images: sanitizedImages,
      },
    };
  }
  return event as unknown as Record<string, unknown>;
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // GET routes
  if (method === "GET") {
    if (path === "/health" || path === "/api/health") return json({ status: "ok", timestamp: new Date().toISOString() });
    if (path === "/api/tools") return json(registry.getDeclarations());
    if (path === "/api/config") return json(config.getAll());
    if (path === "/api/stats") return handleStats();
    if (path === "/api/survival") return json(getSurvivalStats());
    if (path === "/api/thoughts/stream") return handleThoughtsSSE(req);
    if (path === "/api/thoughts") {
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      return json(getRecentThoughts(limit, offset));
    }
    if (path === "/api/timeline/stream") return handleTimelineSSE(req);
    if (path === "/api/timeline") {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      return json(getTimeline(limit, offset));
    }
    if (path === "/api/info") return json({ instanceId: INSTANCE_ID });
    if (path === "/api/tasks/stream") return handleTasksSSE(req);
    if (path === "/api/tasks") {
      const limit = parseInt(url.searchParams.get("limit") || "100");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      return json(tasks.getAllTasks(limit, offset));
    }
    if (path === "/api/sessions") return json(tasks.getSessions());

    if (path === "/api/conversations") {
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const sessionId = url.searchParams.get("sessionId") || undefined;
      return json(tasks.getAllConversationHistory(offset, limit, sessionId));
    }

    if (path === "/api/memory") {
      const query = url.searchParams.get("q");
      const memoryItems = query ? memory.searchMemory(query) : memory.listMemory();
      const knowledgeItems = memory.listKnowledge(20);
      return json([...memoryItems, ...knowledgeItems]);
    }

    // GET /api/images/:filename
    const imageMatch = path.match(/^\/api\/images\/([a-f0-9-]+\.jpg)$/);
    if (imageMatch) {
      return serveImage(imageMatch[1]);
    }

    const sessionsMatch = path.match(/^\/api\/sessions\/([^/]+)\/(history|tasks)$/);
    if (sessionsMatch) {
      const sessionId = sessionsMatch[1];
      return sessionsMatch[2] === "history"
        ? json(tasks.getConversationHistory(sessionId))
        : json(tasks.getRecentTasks(sessionId));
    }

    return json({ error: "Not found" }, 404);
  }

  // POST routes
  if (method === "POST") {
    // POST /api/chat
    if (path === "/api/chat") {
      return handleChat(req);
    }

    // POST /api/memory
    if (path === "/api/memory") {
      return handleCreateMemory(req);
    }
  }

  // PUT routes
  if (method === "PUT") {
    // PUT /api/config/:key
    const configMatch = path.match(/^\/api\/config\/([^/]+)$/);
    if (configMatch) return handleConfigUpdate(req, configMatch[1]);

    // PUT /api/config (batch update)
    if (path === "/api/config") {
      return handleConfigBatchUpdate(req);
    }

    // PUT /api/memory/:id
    const memoryMatch = path.match(/^\/api\/memory\/(\d+)$/);
    if (memoryMatch) return handleUpdateMemory(req, parseInt(memoryMatch[1]));
  }

  // DELETE routes
  if (method === "DELETE") {
    // DELETE /api/memory/:id
    const memoryMatch = path.match(/^\/api\/memory\/(\d+)$/);
    if (memoryMatch) return handleDeleteMemory(parseInt(memoryMatch[1]));
  }

  return json({ error: "Not found" }, 404);
}

function serveImage(filename: string): Response {
  const filepath = `${SCREENSHOT_DIR}/${filename}`;
  if (!existsSync(filepath)) {
    return json({ error: "Image not found" }, 404);
  }

  const data = readFileSync(filepath);
  return new Response(data, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

function handleStats(): Response {
  const apiUsage = getAllApiUsage();
  const browserStats = getBrowserStats();
  
  return json({
    ...apiUsage,
    browser: browserStats,
    activeChats: activeChatCount,
    timestamp: new Date().toISOString(),
  });
}

async function handleChat(req: Request): Promise<Response> {
  // Concurrency guard
  if (activeChatCount >= MAX_CONCURRENT_CHATS) {
    return json({ error: "Too many concurrent chat requests", limit: MAX_CONCURRENT_CHATS }, 429);
  }

  let body: { message?: string; sessionId?: string; images?: Array<{ mimeType: string; data: string }> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const message = body.message;
  if (!message || typeof message !== "string") {
    return json({ error: "\"message\" field is required" }, 400);
  }

  const sessionId = body.sessionId ?? randomUUID();
  const llm = getLLM();
  const corsHeaders = getCorsHeaders();
  const abortSignal = req.signal;

  // Interrupt autonomous loop for better responsiveness
  interruptLoop(60000);

  activeChatCount++;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Heartbeat to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        if (abortSignal.aborted) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Stream already closed
        }
      }, HEARTBEAT_INTERVAL_MS);

      try {
        send("session", { sessionId });

        for await (const event of runAgent(message, { 
          llm, 
          sessionId, 
          signal: abortSignal,
          images: body.images 
        })) {
          if (abortSignal.aborted) break;
          send(event.type, sanitizeEvent(event));
        }
      } catch (err) {
        if (!abortSignal.aborted) {
          const msg = err instanceof Error ? err.message : String(err);
          send("error", { type: "error", error: msg });
        }
      } finally {
        clearInterval(heartbeat);
        activeChatCount--;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders,
    },
  });
}

const VALID_CONFIG_KEYS = new Set(Object.keys(DEFAULTS));

async function handleConfigUpdate(req: Request, key: string): Promise<Response> {
  if (!VALID_CONFIG_KEYS.has(key)) {
    return json(
      { error: `Unknown config key: "${key}"`, validKeys: [...VALID_CONFIG_KEYS] },
      400
    );
  }

  let body: { value?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (body.value === undefined || typeof body.value !== "string") {
    return json({ error: "\"value\" field (string) is required" }, 400);
  }

  try {
    config.set(key, body.value);
    return json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: msg }, 400);
  }
}

async function handleConfigBatchUpdate(req: Request): Promise<Response> {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const results: Array<{ key: string; success: boolean; error?: string }> = [];

  for (const [key, value] of Object.entries(body)) {
    if (!VALID_CONFIG_KEYS.has(key)) {
      results.push({ key, success: false, error: "Unknown config key" });
      continue;
    }

    try {
      config.set(key, value);
      results.push({ key, success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push({ key, success: false, error: msg });
    }
  }

  const allSuccess = results.every((r) => r.success);
  return json({ ok: allSuccess, results }, allSuccess ? 200 : 400);
}

// Memory CRUD handlers
async function handleCreateMemory(req: Request): Promise<Response> {
  let body: { key?: string; value?: string; category?: string; importance?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.key || !body.value) {
    return json({ error: "key and value are required" }, 400);
  }

  try {
    memory.setMemory(body.key, body.value, body.category, body.importance);
    return json({ ok: true }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: msg }, 500);
  }
}

async function handleUpdateMemory(req: Request, id: number): Promise<Response> {
  let body: { key?: string; value?: string; category?: string; importance?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    memory.updateMemory(id, body);
    return json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: msg }, 500);
  }
}

function handleDeleteMemory(id: number): Response {
  try {
    memory.deleteMemory(id);
    return json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return json({ error: msg }, 500);
  }
}

async function handleTimelineSSE(req: Request): Promise<Response> {
  let listenerAttached = false;

  const stream = new ReadableStream({
    start(controller) {
      timelineEvents.once("sse", () => {
        controller.enqueue(Buffer.from("retry: 3000\n\n"));
      });
    },
    pull(controller) {
      if (!listenerAttached) {
        listenerAttached = true;
        timelineEvents.on("sse", (data) => {
          const queue = [Buffer.from(data)];
          const chunk = queue.shift();
          if (chunk) controller.enqueue(chunk);
        });
      }
    },
    cancel() {
      timelineEvents.removeAllListeners("sse");
    },
  });

  return new Response(stream, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleThoughtsSSE(req: Request): Promise<Response> {
  let listenerAttached = false;

  const stream = new ReadableStream({
    start(controller) {
      thoughtsEvents.once("sse", () => {
        controller.enqueue(Buffer.from("retry: 3000\n\n"));
      });
    },
    pull(controller) {
      if (!listenerAttached) {
        listenerAttached = true;
        thoughtsEvents.on("sse", (data) => {
          const queue = [Buffer.from(data)];
          const chunk = queue.shift();
          if (chunk) controller.enqueue(chunk);
        });
      }
    },
    cancel() {
      thoughtsEvents.removeAllListeners("sse");
    },
  });

  return new Response(stream, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleTasksSSE(req: Request): Promise<Response> {
  logger.info('[SSE] Tasks stream connection established');
  let listenerAttached = false;

  const stream = new ReadableStream({
    start(controller) {
      logger.info('[SSE] Tasks stream start() called');
      tasksEvents.once("sse", () => {
        logger.info('[SSE] Tasks emitting retry header');
        controller.enqueue(Buffer.from("retry: 3000\n\n"));
      });
    },
    pull(controller) {
      logger.debug('[SSE] Tasks stream pull() called');
      if (!listenerAttached) {
        listenerAttached = true;
        logger.info('[SSE] Tasks attaching listener');
        tasksEvents.on("sse", (data) => {
          logger.debug(`[SSE] Tasks got data: ${data.substring(0, 50)}`);
          const queue = [Buffer.from(data)];
          const chunk = queue.shift();
          if (chunk) controller.enqueue(chunk);
        });
      }
    },
    cancel() {
      logger.info('[SSE] Tasks stream cancelled');
      tasksEvents.removeAllListeners("sse");
    },
  });

  return new Response(stream, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

