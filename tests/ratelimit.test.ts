// Rate limiter tests
// Tests token bucket algorithm and rate limiting behavior

import { describe, test, expect, beforeEach } from "bun:test";
import { RateLimiter, recordApiUsage, getApiUsage, getAllApiUsage, resetApiUsage, getUsageReport } from "../src/core/ratelimit.js";

describe("RateLimiter", () => {
  test("should initialize with max tokens", () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 10,
      intervalMs: 1000,
      maxTokens: 10,
    });

    expect(limiter.getAvailableTokens()).toBe(10);
  });

  test("should allow acquiring tokens when available", async () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 10,
      intervalMs: 1000,
      maxTokens: 10,
    });

    const startTime = Date.now();
    await limiter.acquire(5);
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(100); // Should not wait
    expect(limiter.getAvailableTokens()).toBe(5);
  });

  test("should block when tokens exhausted", async () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 2,
      intervalMs: 100,
      maxTokens: 2,
    });

    await limiter.acquire(2); // Exhaust tokens
    
    const startTime = Date.now();
    await limiter.acquire(1); // Should wait
    const endTime = Date.now();

    expect(endTime - startTime).toBeGreaterThanOrEqual(50); // Should wait ~50ms
  });

  test("should support tryAcquire without waiting", () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 5,
      intervalMs: 1000,
      maxTokens: 5,
    });

    expect(limiter.tryAcquire(3)).toBe(true);
    expect(limiter.getAvailableTokens()).toBe(2);
    
    expect(limiter.tryAcquire(3)).toBe(false); // Not enough tokens
    expect(limiter.getAvailableTokens()).toBe(2); // Tokens unchanged
  });

  test("should refill tokens over time", async () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 10,
      intervalMs: 200,
      maxTokens: 10,
    });

    await limiter.acquire(10); // Exhaust all tokens
    expect(limiter.getAvailableTokens()).toBe(0);

    // Wait for refill
    await new Promise((resolve) => setTimeout(resolve, 250));
    
    const available = limiter.getAvailableTokens();
    expect(available).toBeGreaterThan(0);
  });

  test("should not exceed max tokens when refilling", async () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 10,
      intervalMs: 100,
      maxTokens: 5,
    });

    await limiter.acquire(5);
    
    // Wait longer than one interval
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    expect(limiter.getAvailableTokens()).toBe(5); // Should cap at max
  });

  test("should provide statistics", () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 10,
      intervalMs: 1000,
      maxTokens: 10,
    });

    const stats = limiter.getStats();
    
    expect(stats.available).toBe(10);
    expect(stats.max).toBe(10);
    expect(stats.percent).toBe(100);

    limiter.tryAcquire(5);
    
    const newStats = limiter.getStats();
    expect(newStats.available).toBe(5);
    expect(newStats.percent).toBe(50);
  });

  test("should handle concurrent acquisitions", async () => {
    const limiter = new RateLimiter({
      tokensPerInterval: 10,
      intervalMs: 1000,
      maxTokens: 10,
    });

    const promises = [
      limiter.acquire(3),
      limiter.acquire(3),
      limiter.acquire(3),
    ];

    await Promise.all(promises);
    
    expect(limiter.getAvailableTokens()).toBe(1);
  });
});

describe("API Usage Tracking", () => {
  beforeEach(() => {
    resetApiUsage();
  });

  test("should record successful API usage", () => {
    recordApiUsage("gemini", 100, true);
    
    const stats = getApiUsage("gemini");
    expect(stats).toBeDefined();
    expect(stats?.totalRequests).toBe(1);
    expect(stats?.totalTokens).toBe(100);
    expect(stats?.errors).toBe(0);
  });

  test("should record failed API usage", () => {
    recordApiUsage("gemini", 50, false);
    
    const stats = getApiUsage("gemini");
    expect(stats?.totalRequests).toBe(1);
    expect(stats?.errors).toBe(1);
  });

  test("should accumulate multiple requests", () => {
    recordApiUsage("gemini", 100, true);
    recordApiUsage("gemini", 150, true);
    recordApiUsage("gemini", 50, false);
    
    const stats = getApiUsage("gemini");
    expect(stats?.totalRequests).toBe(3);
    expect(stats?.totalTokens).toBe(300);
    expect(stats?.errors).toBe(1);
  });

  test("should track multiple APIs separately", () => {
    recordApiUsage("gemini", 100, true);
    recordApiUsage("openai", 200, true);
    
    const geminiStats = getApiUsage("gemini");
    const openaiStats = getApiUsage("openai");
    
    expect(geminiStats?.totalTokens).toBe(100);
    expect(openaiStats?.totalTokens).toBe(200);
  });

  test("should return all API usage", () => {
    recordApiUsage("api1", 100, true);
    recordApiUsage("api2", 200, false);
    
    const all = getAllApiUsage();
    
    expect(Object.keys(all)).toHaveLength(2);
    expect(all.api1.totalTokens).toBe(100);
    expect(all.api2.errors).toBe(1);
  });

  test("should reset all usage data", () => {
    recordApiUsage("gemini", 100, true);
    
    resetApiUsage();
    
    const stats = getApiUsage("gemini");
    expect(stats).toBeUndefined();
  });

  test("should generate usage report", () => {
    recordApiUsage("gemini", 1000, true);
    recordApiUsage("gemini", 500, false);
    
    const report = getUsageReport();
    
    expect(report).toContain("API Usage Report");
    expect(report).toContain("gemini");
    expect(report).toContain("Requests: 2");
    expect(report).toContain("Tokens: 1,500");
    expect(report).toContain("Errors: 1");
  });

  test("should update last request time", async () => {
    const before = Date.now();
    recordApiUsage("gemini", 100, true);
    const after = Date.now();
    
    const stats = getApiUsage("gemini");
    expect(stats?.lastRequestTime).toBeGreaterThanOrEqual(before);
    expect(stats?.lastRequestTime).toBeLessThanOrEqual(after);
  });
});
