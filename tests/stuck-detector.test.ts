// Stuck detector tests
// Tests loop detection and termination logic

import { describe, test, expect, beforeEach } from "bun:test";
import { StuckDetector } from "../src/agent/stuck-detector.js";
import { MAX_ITERATIONS, STUCK_DETECTION } from "../src/core/constants.js";

describe("StuckDetector", () => {
  let detector: StuckDetector;

  beforeEach(() => {
    detector = new StuckDetector();
  });

  test("should initialize with default max iterations", () => {
    expect(detector.getMaxIterations()).toBe(MAX_ITERATIONS.DEFAULT);
    expect(detector.getIteration()).toBe(0);
  });

  test("should accept custom max iterations", () => {
    const custom = new StuckDetector(50);
    expect(custom.getMaxIterations()).toBe(50);
  });

  test("should enforce minimum iterations limit", () => {
    const minDetector = new StuckDetector(0);
    expect(minDetector.getMaxIterations()).toBe(MAX_ITERATIONS.MIN);
  });

  test("should enforce maximum iterations limit", () => {
    const maxDetector = new StuckDetector(10000);
    expect(maxDetector.getMaxIterations()).toBe(MAX_ITERATIONS.MAX);
  });

  test("should record calls", () => {
    detector.record("shell", '{"command": "ls"}');
    expect(detector.getIteration()).toBe(1);
    
    detector.record("file", '{"action": "read"}');
    expect(detector.getIteration()).toBe(2);
  });

  test("should detect not stuck initially", () => {
    detector.record("shell", '{"command": "ls"}');
    detector.record("file", '{"action": "read"}');
    
    const check = detector.check();
    expect(check.isStuck).toBe(false);
    expect(check.shouldTerminate).toBe(false);
  });

  test("should detect same tool with same input 3 times", () => {
    const input = '{"command": "ls"}';
    
    detector.record("shell", input);
    detector.record("shell", input);
    detector.record("shell", input);
    
    const check = detector.check();
    expect(check.isStuck).toBe(true);
    expect(check.shouldTerminate).toBe(false);
    expect(check.message).toContain("3 times in a row");
    expect(check.message).toContain("shell");
  });

  test("should detect same tool used 10 times consecutively", () => {
    // Use different inputs to avoid triggering the "same input" rule
    for (let i = 0; i < 10; i++) {
      detector.record("web", `{"url": "http://example.com/${i}"}`);
    }
    
    const check = detector.check();
    expect(check.isStuck).toBe(true);
    expect(check.shouldTerminate).toBe(false);
    expect(check.message).toContain("10 times in a row");
    expect(check.message).toContain("web");
  });

  test("should detect max iterations reached", () => {
    const smallDetector = new StuckDetector(5);
    
    for (let i = 0; i < 5; i++) {
      smallDetector.record("shell", `{"cmd": "${i}"}`);
    }
    
    const check = smallDetector.check();
    expect(check.isStuck).toBe(true);
    expect(check.shouldTerminate).toBe(true);
    expect(check.message).toContain("maximum of 5 iterations");
  });

  test("should not detect stuck with different tools", () => {
    for (let i = 0; i < 15; i++) {
      detector.record(i % 2 === 0 ? "shell" : "file", `{"cmd": "${i}"}`);
    }
    
    const check = detector.check();
    expect(check.isStuck).toBe(false);
  });

  test("should not detect stuck with different inputs", () => {
    for (let i = 0; i < 5; i++) {
      detector.record("shell", `{"command": "test${i}"}`);
    }
    
    const check = detector.check();
    expect(check.isStuck).toBe(false);
  });

  test("should reset state", () => {
    detector.record("shell", '{"cmd": "1"}');
    detector.record("shell", '{"cmd": "2"}');
    
    expect(detector.getIteration()).toBe(2);
    
    detector.reset();
    
    expect(detector.getIteration()).toBe(0);
    expect(detector.getHistory()).toHaveLength(0);
  });

  test("should provide statistics", () => {
    detector.record("shell", '{"cmd": "1"}');
    detector.record("file", '{"cmd": "2"}');
    detector.record("shell", '{"cmd": "3"}');
    
    const stats = detector.getStats();
    
    expect(stats.iteration).toBe(3);
    expect(stats.totalCalls).toBe(3);
    expect(stats.uniqueTools).toBe(2);
    expect(stats.maxIterations).toBe(MAX_ITERATIONS.DEFAULT);
  });

  test("should track history", () => {
    detector.record("shell", '{"cmd": "1"}');
    detector.record("file", '{"cmd": "2"}');
    
    const history = detector.getHistory();
    
    expect(history).toHaveLength(2);
    expect(history[0].toolName).toBe("shell");
    expect(history[1].toolName).toBe("file");
    expect(history[0].iteration).toBe(1);
    expect(history[1].iteration).toBe(2);
  });

  test("should detect stuck after reset and new pattern", () => {
    // First pattern
    for (let i = 0; i < 3; i++) {
      detector.record("shell", '{"cmd": "old"}');
    }
    
    let check = detector.check();
    expect(check.isStuck).toBe(true);
    
    // Reset
    detector.reset();
    
    // New pattern
    for (let i = 0; i < 3; i++) {
      detector.record("file", '{"cmd": "new"}');
    }
    
    check = detector.check();
    expect(check.isStuck).toBe(true);
    expect(check.message).toContain("file");
  });

  test("should handle empty detector", () => {
    const check = detector.check();
    expect(check.isStuck).toBe(false);
    expect(check.shouldTerminate).toBe(false);
  });

  test("should handle single call", () => {
    detector.record("shell", '{"cmd": "test"}');
    
    const check = detector.check();
    expect(check.isStuck).toBe(false);
  });

  test("should handle two calls", () => {
    detector.record("shell", '{"cmd": "test"}');
    detector.record("shell", '{"cmd": "test"}');
    
    const check = detector.check();
    expect(check.isStuck).toBe(false); // Need 3 for detection
  });

  test("should use Bun.hash for input comparison", () => {
    const input1 = '{"command": "ls"}';
    const input2 = '{"command": "ls"}';
    const input3 = '{"command": "pwd"}';
    
    // Same inputs should produce same hash
    detector.record("shell", input1);
    detector.record("shell", input2);
    
    let check = detector.check();
    expect(check.isStuck).toBe(false); // Only 2 same calls
    
    detector.record("shell", input3);
    
    check = detector.check();
    expect(check.isStuck).toBe(false); // Different input breaks pattern
  });
});

describe("StuckDetector Edge Cases", () => {
  test("should handle very long input strings", () => {
    const detector = new StuckDetector();
    const longInput = "x".repeat(10000);
    
    for (let i = 0; i < 3; i++) {
      detector.record("shell", longInput);
    }
    
    const check = detector.check();
    expect(check.isStuck).toBe(true);
  });

  test("should handle special characters in inputs", () => {
    const detector = new StuckDetector();
    const specialInput = '{"cmd": "echo \"hello\\nworld\""}';
    
    for (let i = 0; i < 3; i++) {
      detector.record("shell", specialInput);
    }
    
    const check = detector.check();
    expect(check.isStuck).toBe(true);
  });

  test("should handle unicode in inputs", () => {
    const detector = new StuckDetector();
    const unicodeInput = '{"text": "안녕하세요"}';
    
    for (let i = 0; i < 3; i++) {
      detector.record("shell", unicodeInput);
    }
    
    const check = detector.check();
    expect(check.isStuck).toBe(true);
  });
});
