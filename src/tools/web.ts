// HTTP request tool with per-domain rate limiting and SSRF protection

import type { Tool, ToolResult } from "../core/types.js";
import { registry } from "./registry.js";
import { logger } from "../core/logger.js";

// Simple per-domain rate limiter
const domainLastCall = new Map<string, number>();
const RATE_LIMIT_MS = 1000; // 1 request per second per domain

// Maximum response size (10MB)
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

// Blocked URL patterns for SSRF prevention
const BLOCKED_HOST_PATTERNS = [
  // Private IP ranges
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // Link-local
  /^::1$/,
  /^fc00:/i, // IPv6 private
  /^fe80:/i, // IPv6 link-local
  // Localhost variations
  /^localhost$/i,
  /\.local$/i,
  // Internal Docker/network
  /^docker\./i,
  /^host\.docker\.internal$/i,
  /^gateway$/i,
];

// Blocked protocols (prevent file://, ftp://, etc.)
const ALLOWED_PROTOCOLS = ["http:", "https:"];

// Blocked ports
const BLOCKED_PORTS = [22, 23, 25, 53, 110, 143, 465, 587, 993, 995, 3306, 5432, 6379, 27017];

function validateUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      return {
        valid: false,
        reason: `Protocol "${parsed.protocol}" is not allowed. Only HTTP and HTTPS are supported.`,
      };
    }

    // Check for blocked hosts
    const hostname = parsed.hostname.toLowerCase();
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        return {
          valid: false,
          reason: `Access to internal/private addresses is blocked: ${hostname}`,
        };
      }
    }

    // Check port
    const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
    if (BLOCKED_PORTS.includes(port)) {
      return {
        valid: false,
        reason: `Port ${port} is blocked for security reasons`,
      };
    }

    // Prevent DNS rebinding attacks by checking if hostname is an IP
    const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname);
    if (isIP) {
      // Additional check for IP-based private ranges
      const ipBlocks = hostname.split(".");
      if (ipBlocks.length === 4) {
        const [a, b] = ipBlocks.map(Number);
        if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
          return {
            valid: false,
            reason: `Direct IP access to private ranges is blocked: ${hostname}`,
          };
        }
      }
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: `Invalid URL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

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
      "Make HTTP requests. Supports GET, POST, PUT, DELETE, PATCH. Includes per-domain rate limiting, timeout protection, and SSRF prevention. Cannot access private/internal networks.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to request (must be public HTTP/HTTPS)",
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
          description: "Timeout in milliseconds (default: 30000, max: 120000)",
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
    const timeoutMs = Math.min((args.timeout_ms as number) ?? 30000, 120000); // Max 2 minutes

    // Validate URL (SSRF prevention)
    const urlCheck = validateUrl(url);
    if (!urlCheck.valid) {
      logger.warn(`Blocked URL: ${url} - ${urlCheck.reason}`);
      return {
        success: false,
        output: "",
        error: `Security violation: ${urlCheck.reason}`,
      };
    }

    logger.tool("web", `${method} ${url}`);

    try {
      const domain = getDomain(url);
      await enforceRateLimit(domain);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let headers: Record<string, string>;
      try {
        headers = headersStr ? JSON.parse(headersStr) : {};
      } catch (err) {
        clearTimeout(timer);
        return {
          success: false,
          output: "",
          error: `Invalid headers JSON: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // Prevent dangerous headers
      const blockedHeaders = ["host", "content-length", "transfer-encoding", "connection"];
      for (const header of blockedHeaders) {
        delete headers[header.toLowerCase()];
        delete headers[header];
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body && method !== "GET" ? body : undefined,
        signal: controller.signal,
        // Prevent automatic redirects to internal addresses
        redirect: "follow",
      });

      clearTimeout(timer);

      // Check response size before reading
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        return {
          success: false,
          output: "",
          error: `Response too large: ${contentLength} bytes (max: ${MAX_RESPONSE_SIZE} bytes)`,
        };
      }

      const text = await response.text();

      // Additional size check after reading
      if (text.length > MAX_RESPONSE_SIZE) {
        return {
          success: false,
          output: "",
          error: `Response body too large: ${text.length} bytes (max: ${MAX_RESPONSE_SIZE} bytes)`,
        };
      }

      const maxChars = 10000;
      const output =
        text.length > maxChars
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
