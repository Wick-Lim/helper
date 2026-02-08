// ANSI color logging module with PII masking and request tracking

import { AsyncLocalStorage } from "async_hooks";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

let verbose = false;

// AsyncLocalStorage for request context
const requestContext = new AsyncLocalStorage<{ requestId: string; sessionId?: string }>();

// Patterns to mask (PII detection)
const PII_PATTERNS: Array<{ pattern: RegExp; mask: string }> = [
  // API Keys and Tokens
  { pattern: /\b[A-Za-z0-9_-]{32,}\b/g, mask: "***API_KEY***" },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, mask: "***EMAIL***" },
  // Phone numbers (various formats)
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, mask: "***PHONE***" },
  // Credit card numbers (basic Luhn pattern)
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g, mask: "***CARD***" },
  // SSN patterns
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, mask: "***SSN***" },
  // IP addresses (might be internal)
  { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, mask: "***IP***" },
  // Sensitive keywords with values
  { pattern: /(password|passwd|pwd)\s*[:=]\s*\S+/gi, mask: '$1: ***REDACTED***' },
  { pattern: /(secret|token|key)\s*[:=]\s*\S+/gi, mask: '$1: ***REDACTED***' },
  { pattern: /(api[_-]?key)\s*[:=]\s*\S+/gi, mask: '$1: ***REDACTED***' },
  { pattern: /(authorization|auth)\s*[:=]\s*\S+/gi, mask: '$1: ***REDACTED***' },
  // Long hex strings (often API keys or hashes)
  { pattern: /\b[a-f0-9]{32,}\b/gi, mask: "***HASH***" },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9_-]+/gi, mask: "Bearer ***TOKEN***" },
];

// Environment variables to always mask
const SENSITIVE_ENV_VARS = [
  'GEMINI_API_KEY',
  'TELEGRAM_TOKEN', 
  'API_KEY',
  'SECRET',
  'PASSWORD',
  'PRIVATE_KEY',
  'DATABASE_URL',
];

export function setVerbose(v: boolean): void {
  verbose = v;
}

export function getRequestContext(): { requestId: string; sessionId?: string } | undefined {
  return requestContext.getStore();
}

export function runWithContext<T>(
  context: { requestId: string; sessionId?: string },
  fn: () => T | Promise<T>
): Promise<T> {
  return requestContext.run(context, fn);
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

export function getOrCreateRequestId(): string {
  const ctx = requestContext.getStore();
  if (ctx) {
    return ctx.requestId;
  }
  return generateRequestId();
}

function maskPII(text: string): string {
  if (!text || typeof text !== 'string') return String(text);
  
  let masked = text;
  for (const { pattern, mask } of PII_PATTERNS) {
    masked = masked.replace(pattern, mask);
  }
  return masked;
}

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (typeof arg === 'string') {
      return maskPII(arg);
    }
    if (arg instanceof Error) {
      return new Error(maskPII(arg.message));
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        const str = JSON.stringify(arg);
        return JSON.parse(maskPII(str));
      } catch {
        return arg;
      }
    }
    return arg;
  });
}

function formatContext(): string {
  const ctx = requestContext.getStore();
  if (!ctx) return '';
  
  const parts: string[] = [ctx.requestId.slice(-8)];
  if (ctx.sessionId) {
    parts.push(ctx.sessionId.slice(-6));
  }
  return `${GRAY}[${parts.join('|')}]${RESET} `;
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const logger = {
  info(msg: string, ...args: unknown[]): void {
    console.log(
      `${GRAY}${timestamp()}${RESET} ${GREEN}INFO${RESET}  ${formatContext()}${maskPII(msg)}`,
      ...sanitizeArgs(args)
    );
  },

  agent(msg: string, ...args: unknown[]): void {
    console.log(
      `${GRAY}${timestamp()}${RESET} ${CYAN}${BOLD}AGENT${RESET} ${formatContext()}${maskPII(msg)}`,
      ...sanitizeArgs(args)
    );
  },

  tool(name: string, msg: string, ...args: unknown[]): void {
    console.log(
      `${GRAY}${timestamp()}${RESET} ${MAGENTA}TOOL${RESET}  ${formatContext()}${DIM}[${name}]${RESET} ${maskPII(msg)}`,
      ...sanitizeArgs(args)
    );
  },

  warn(msg: string, ...args: unknown[]): void {
    console.warn(
      `${GRAY}${timestamp()}${RESET} ${YELLOW}WARN${RESET}  ${formatContext()}${maskPII(msg)}`,
      ...sanitizeArgs(args)
    );
  },

  error(msg: string, ...args: unknown[]): void {
    console.error(
      `${GRAY}${timestamp()}${RESET} ${RED}ERROR${RESET} ${formatContext()}${maskPII(msg)}`,
      ...sanitizeArgs(args)
    );
  },

  debug(msg: string, ...args: unknown[]): void {
    if (verbose) {
      console.log(
        `${GRAY}${timestamp()} DEBUG ${formatContext()}${maskPII(msg)}${RESET}`,
        ...sanitizeArgs(args)
      );
    }
  },

  thinking(msg: string): void {
    console.log(
      `${GRAY}${timestamp()}${RESET} ${BLUE}THINK${RESET} ${formatContext()}${DIM}${maskPII(msg)}${RESET}`
    );
  },

  security(msg: string, ...args: unknown[]): void {
    console.warn(
      `${GRAY}${timestamp()}${RESET} ${RED}${BOLD}SECURITY${RESET} ${formatContext()}${maskPII(msg)}`,
      ...sanitizeArgs(args)
    );
  },
};

// Export for testing
export function testMasking(text: string): string {
  return maskPII(text);
}
