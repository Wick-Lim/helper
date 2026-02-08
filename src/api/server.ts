// HTTP API server using Bun.serve()

import { handleRequest, getActiveChatCount } from "./routes.js";
import { logger } from "../core/logger.js";
import { onShutdown } from "../core/signals.js";
import type { LLMClient } from "../llm/types.js";
import type { Server } from "bun";

const MAX_BODY_BYTES = 1024 * 1024; // 1MB
const DRAIN_TIMEOUT_MS = 30_000;
const DRAIN_POLL_MS = 500;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

let llmClient: LLMClient;
let serverInstance: Server | null = null;

export function getLLM(): LLMClient {
  return llmClient;
}

export function getCorsHeaders(): Record<string, string> {
  return corsHeaders;
}

/** Wait for active chat streams to drain, then stop the server */
async function stopServer(): Promise<void> {
  if (!serverInstance) return;

  // Stop accepting new connections
  serverInstance.stop();
  logger.info("Server stopped accepting new connections");

  // Wait for active chats to drain
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (getActiveChatCount() > 0 && Date.now() < deadline) {
    logger.info(`Waiting for ${getActiveChatCount()} active chat(s) to finish...`);
    await new Promise((r) => setTimeout(r, DRAIN_POLL_MS));
  }

  if (getActiveChatCount() > 0) {
    logger.warn(`Forcing shutdown with ${getActiveChatCount()} active chat(s)`);
  }

  serverInstance = null;
}

/** Serve static web UI files */
async function serveStaticFile(path: string): Promise<Response> {
  try {
    // Map root path to index.html
    if (path === "/" || path === "/index.html") {
      const file = Bun.file("./src/webui/index.html");
      return new Response(file, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve app.js and other static files
    const filePath = path.startsWith("/") ? path.slice(1) : path;
    const fullPath = `./src/webui/${filePath}`;
    const file = Bun.file(fullPath);

    // Check if file exists by trying to get its size
    try {
      await file.arrayBuffer();
    } catch {
      return new Response("Not found", { status: 404 });
    }

    // Determine content type
    const ext = filePath.split(".").pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
      html: "text/html",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
    };

    return new Response(file, {
      headers: {
        "Content-Type": contentTypes[ext || ""] || "application/octet-stream",
        "Cache-Control": ext === "html" ? "no-cache" : "public, max-age=3600",
      },
    });
  } catch (error) {
    logger.error(`Failed to serve static file ${path}: ${error}`);
    return new Response("Internal server error", { status: 500 });
  }
}

export function startServer(port: number, llm: LLMClient): void {
  llmClient = llm;

  serverInstance = Bun.serve({
    port,
    async fetch(req) {
      const start = Date.now();
      const method = req.method;
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Serve WebUI static files for root and /app.js
      if (path === "/" || path === "/index.html" || path === "/app.js") {
        const response = await serveStaticFile(path);
        // Add CORS headers
        for (const [key, value] of Object.entries(corsHeaders)) {
          response.headers.set(key, value);
        }
        return response;
      }

      // Body size guard
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
        logger.warn(`Rejected oversized request: ${method} ${path} (${contentLength} bytes)`);
        return new Response(
          JSON.stringify({ error: "Request body too large", maxBytes: MAX_BODY_BYTES }),
          { status: 413, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      try {
        const response = await handleRequest(req);
        // Add CORS headers to all responses
        for (const [key, value] of Object.entries(corsHeaders)) {
          response.headers.set(key, value);
        }

        const duration = Date.now() - start;
        logger.info(`${method} ${path} ${response.status} ${duration}ms`);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - start;
        logger.error(`${method} ${path} 500 ${duration}ms — ${message}`);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    },
  });

  // Register shutdown: stopServer runs FIRST (LIFO), then closeBrowser, then closeDB
  onShutdown(stopServer);

  logger.info(`API server listening on port ${port}`);
  logger.info(`WebUI available at http://localhost:${port}/`);
}
