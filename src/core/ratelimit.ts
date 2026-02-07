// Token bucket rate limiter for API calls
// Prevents excessive API usage and costs

import { RATE_LIMITS } from "./constants.js";

/**
 * Configuration options for the rate limiter
 */
export interface RateLimiterOptions {
  /** Number of tokens to add per interval */
  tokensPerInterval: number;
  /** Interval duration in milliseconds */
  intervalMs: number;
  /** Maximum token capacity */
  maxTokens: number;
}

/**
 * Token bucket rate limiter implementation
 * Thread-safe for single-process use (Node.js/Bun)
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly tokensPerInterval: number;
  private readonly intervalMs: number;
  private readonly maxTokens: number;

  /**
   * Create a new rate limiter
   * @param options - Rate limiter configuration
   */
  constructor(options: RateLimiterOptions) {
    this.tokensPerInterval = options.tokensPerInterval;
    this.intervalMs = options.intervalMs;
    this.maxTokens = options.maxTokens;
    this.tokens = options.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time
   * @private
   */
  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor((timePassed / this.intervalMs) * this.tokensPerInterval);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Acquire tokens, waiting if necessary
   * @param tokens - Number of tokens to acquire (default: 1)
   * @returns Promise that resolves when tokens are acquired
   */
  async acquire(tokens = 1): Promise<void> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Calculate wait time
    const tokensNeeded = tokens - this.tokens;
    const waitMs = Math.ceil((tokensNeeded / this.tokensPerInterval) * this.intervalMs);

    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens -= tokens;
  }

  /**
   * Try to acquire tokens without waiting
   * @param tokens - Number of tokens to acquire (default: 1)
   * @returns True if tokens were acquired, false otherwise
   */
  tryAcquire(tokens = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Get the number of available tokens
   * @returns Current available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get rate limiter statistics
   * @returns Object with statistics
   */
  getStats(): {
    available: number;
    max: number;
    percent: number;
  } {
    const available = this.getAvailableTokens();
    return {
      available,
      max: this.maxTokens,
      percent: (available / this.maxTokens) * 100,
    };
  }
}

// Rate limiters for different API endpoints
/**
 * Global rate limiters for external APIs
 */
export const rateLimiters = {
  /**
   * Gemini API rate limiter
   * Conservative: 30 requests per minute (free tier: 60/min)
   */
  gemini: new RateLimiter({
    tokensPerInterval: RATE_LIMITS.GEMINI.REQUESTS_PER_MINUTE,
    intervalMs: 60000, // 1 minute
    maxTokens: RATE_LIMITS.GEMINI.MAX_TOKENS,
  }),

  /**
   * Web requests global safety net
   * Per-domain rate limiting handled in web.ts
   */
  web: new RateLimiter({
    tokensPerInterval: RATE_LIMITS.WEB.REQUESTS_PER_MINUTE,
    intervalMs: 60000,
    maxTokens: RATE_LIMITS.WEB.REQUESTS_PER_MINUTE,
  }),
};

/**
 * API usage statistics
 */
export interface UsageStats {
  /** Total number of requests made */
  totalRequests: number;
  /** Total tokens consumed */
  totalTokens: number;
  /** Number of failed requests */
  errors: number;
  /** Timestamp of the last request */
  lastRequestTime: number;
}

// Track API usage statistics
const usageStats: Map<string, UsageStats> = new Map();

/**
 * Record API usage for statistics
 * @param apiName - Name of the API (e.g., "gemini")
 * @param tokens - Number of tokens consumed
 * @param success - Whether the request was successful
 */
export function recordApiUsage(
  apiName: string,
  tokens: number,
  success: boolean
): void {
  const stats = usageStats.get(apiName) ?? {
    totalRequests: 0,
    totalTokens: 0,
    errors: 0,
    lastRequestTime: 0,
  };

  stats.totalRequests++;
  stats.totalTokens += tokens;
  if (!success) stats.errors++;
  stats.lastRequestTime = Date.now();

  usageStats.set(apiName, stats);
}

/**
 * Get usage statistics for a specific API
 * @param apiName - Name of the API
 * @returns Usage statistics or undefined if not found
 */
export function getApiUsage(apiName: string): UsageStats | undefined {
  return usageStats.get(apiName);
}

/**
 * Get all API usage statistics
 * @returns Record of all API usage stats
 */
export function getAllApiUsage(): Record<string, UsageStats> {
  return Object.fromEntries(usageStats);
}

/**
 * Reset all API usage statistics
 */
export function resetApiUsage(): void {
  usageStats.clear();
}

/**
 * Get formatted usage report
 * @returns Human-readable usage report
 */
export function getUsageReport(): string {
  const stats = getAllApiUsage();
  const lines: string[] = ["API Usage Report:"];
  
  for (const [api, data] of Object.entries(stats)) {
    const errorRate = data.totalRequests > 0 
      ? ((data.errors / data.totalRequests) * 100).toFixed(1)
      : "0.0";
    
    lines.push(`  ${api}:`);
    lines.push(`    Requests: ${data.totalRequests}`);
    lines.push(`    Tokens: ${data.totalTokens.toLocaleString()}`);
    lines.push(`    Errors: ${data.errors} (${errorRate}%)`);
    lines.push(`    Last used: ${new Date(data.lastRequestTime).toISOString()}`);
  }
  
  return lines.join("\n");
}
