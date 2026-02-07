// Exponential backoff retry logic with error classification

import { RetryableError, FatalError } from "../core/errors.js";
import { logger } from "../core/logger.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

export function classifyHttpError(status: number, body?: string): Error {
  if (status === 401 || status === 403) {
    return new FatalError(`Authentication failed (${status}): ${body ?? "Check GEMINI_API_KEY"}`);
  }
  if (status === 429) {
    return new RetryableError(`Rate limited (429)`, 5000);
  }
  if (status >= 500) {
    return new RetryableError(`Server error (${status})`, 2000);
  }
  return new FatalError(`Request failed (${status}): ${body ?? "Unknown error"}`);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Fatal errors should not be retried
      if (err instanceof FatalError) {
        throw err;
      }

      if (attempt === opts.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff + jitter
      const retryAfter = err instanceof RetryableError ? err.retryAfterMs : undefined;
      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt);
      const delay = retryAfter ?? Math.min(exponentialDelay, opts.maxDelayMs);
      const jitter = delay * 0.1 * Math.random();

      logger.warn(`Attempt ${attempt + 1}/${opts.maxRetries + 1} failed: ${lastError.message}. Retrying in ${Math.round(delay + jitter)}ms...`);

      await Bun.sleep(delay + jitter);
    }
  }

  throw lastError ?? new Error("Retry exhausted with no error captured");
}
