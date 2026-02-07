// HTTP request tool with per-domain rate limiting and timeout

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";

// Simple per-domain rate limiter
const domainLastCall = new Map<string, number>();
const RATE_LIMIT_MS = 1000; // 1 request per second per domain

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

async function enforceRateLimit(domain: string): Promise<void> {
  const last = domainLastCall.get(domain);
  if (last) {
    const elapsed = Date.now() - last;
    if (elapsed < RATE_LIMIT_MS) {
      await Bun.sleep(RATE_LIMIT_MS - elapsed);
    }
  }
  domainLastCall.set(domain, Date.now());
}

const webTool: Tool = {
  declaration: {
    name: "web",
    description:
      "Make HTTP requests. Supports GET, POST, PUT, DELETE. Includes per-domain rate limiting and timeout protection.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to request",
        },
        method: {
          type: "string",
          description: "HTTP method (default: GET)",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        },
        headers: {
          type: "string",
          description: "JSON string of headers",
        },
        body: {
          type: "string",
          description: "Request body (for POST/PUT/PATCH)",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["url"],
    },
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args.url as string;
    const method = (args.method as string) ?? "GET";
    const headersStr = args.headers as string | undefined;
    const body = args.body as string | undefined;
    const timeoutMs = (args.timeout_ms as number) ?? 30000;

    logger.tool("web", `${method} ${url}`);

    try {
      const domain = getDomain(url);
      await enforceRateLimit(domain);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const headers: Record<string, string> = headersStr
        ? JSON.parse(headersStr)
        : {};

      const response = await fetch(url, {
        method,
        headers,
        body: body && method !== "GET" ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const text = await response.text();
      const maxChars = 10000;
      const output = text.length > maxChars
        ? text.slice(0, maxChars) + `\n... [truncated ${text.length - maxChars} chars]`
        : text;

      return {
        success: response.ok,
        output: `HTTP ${response.status}\n${output}`,
        error: !response.ok ? `HTTP ${response.status} ${response.statusText}` : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: "",
        error: message.includes("abort") ? `Request timed out after ${timeoutMs}ms` : message,
      };
    }
  },
};

registry.register(webTool);
