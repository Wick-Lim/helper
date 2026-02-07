// Configuration validation tests
// Tests config validation rules and defaults

import { describe, test, expect, beforeEach } from "bun:test";
import { initDB, closeDB, getDB } from "../src/db/index.js";
import {
  get,
  getNumber,
  getBool,
  set,
  remove,
  getAll,
  resetToDefaults,
  DEFAULTS,
} from "../src/db/config.js";
import { MAX_ITERATIONS, GENERATION, TIMEOUTS } from "../src/core/constants.js";

describe("Configuration Validation", () => {
  beforeEach(() => {
    try {
      closeDB();
    } catch {
      // Not initialized
    }
    initDB(":memory:");
  });

  test("should return default values", () => {
    expect(get("max_iterations")).toBe(DEFAULTS.max_iterations);
    expect(get("temperature")).toBe(DEFAULTS.temperature);
    expect(get("verbose")).toBe(DEFAULTS.verbose);
  });

  test("should validate max_iterations range", () => {
    // Too low
    expect(() => set("max_iterations", "0")).toThrow();
    expect(() => set("max_iterations", "-1")).toThrow();
    
    // Valid
    set("max_iterations", "50");
    expect(getNumber("max_iterations")).toBe(50);
    
    // Too high
    expect(() => set("max_iterations", "2000")).toThrow();
  });

  test("should validate temperature range", () => {
    // Too low
    expect(() => set("temperature", "-0.1")).toThrow();
    
    // Valid values
    set("temperature", "0");
    expect(getNumber("temperature")).toBe(0);
    
    set("temperature", "1.5");
    expect(getNumber("temperature")).toBe(1.5);
    
    // Too high
    expect(() => set("temperature", "2.1")).toThrow();
  });

  test("should validate tool_timeout_ms range", () => {
    // Too low
    expect(() => set("tool_timeout_ms", "500")).toThrow();
    
    // Valid
    set("tool_timeout_ms", "60000");
    expect(getNumber("tool_timeout_ms")).toBe(60000);
    
    // Too high
    expect(() => set("tool_timeout_ms", "600001")).toThrow();
  });

  test("should validate boolean values", () => {
    // Valid boolean strings
    set("verbose", "true");
    expect(getBool("verbose")).toBe(true);
    
    set("verbose", "false");
    expect(getBool("verbose")).toBe(false);
    
    set("verbose", "1");
    expect(getBool("verbose")).toBe(true);
    
    set("verbose", "0");
    expect(getBool("verbose")).toBe(false);
    
    // Invalid
    expect(() => set("verbose", "yes")).toThrow();
    expect(() => set("verbose", "no")).toThrow();
  });

  test("should validate model name pattern", () => {
    // Valid
    set("model", "gemini-2.5-flash");
    expect(get("model")).toBe("gemini-2.5-flash");
    
    set("model", "gemini-3-pro");
    expect(get("model")).toBe("gemini-3-pro");
    
    // Invalid - should throw
    expect(() => set("model", "invalid-model")).toThrow();
    expect(() => set("model", "gpt-4")).toThrow();
  });

  test("should store and retrieve custom values", () => {
    // Use a key without validation rules by inserting directly
    const db = getDB();
    db.run(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      ["custom_key", "custom_value", "custom_value"]
    );
    expect(get("custom_key")).toBe("custom_value");
  });

  test("should get all configuration", () => {
    set("max_iterations", "75");
    set("temperature", "0.5");
    
    const all = getAll();
    
    expect(all.max_iterations).toBe("75");
    expect(all.temperature).toBe("0.5");
    expect(all.verbose).toBe(DEFAULTS.verbose); // Unchanged
  });

  test("should remove configuration", () => {
    // Use custom key by inserting directly
    const db = getDB();
    db.run(
      "INSERT INTO config (key, value) VALUES (?, ?)",
      ["temp_key", "temp_value"]
    );
    expect(get("temp_key")).toBe("temp_value");
    
    remove("temp_key");
    expect(get("temp_key")).toBeUndefined();
  });

  test("should prevent removal of critical keys", () => {
    expect(() => remove("max_iterations")).toThrow();
    expect(() => remove("tool_timeout_ms")).toThrow();
  });

  test("should reset to defaults", () => {
    set("max_iterations", "99");
    set("temperature", "0.9");
    
    resetToDefaults();
    
    expect(get("max_iterations")).toBe(DEFAULTS.max_iterations);
    expect(get("temperature")).toBe(DEFAULTS.temperature);
  });

  test("should use constants for validation", () => {
    // max_iterations should respect MAX_ITERATIONS constants
    expect(MAX_ITERATIONS.MIN).toBe(1);
    expect(MAX_ITERATIONS.MAX).toBe(1000);
    
    // temperature should respect GENERATION constants
    expect(GENERATION.TEMPERATURE.MIN).toBe(0);
    expect(GENERATION.TEMPERATURE.MAX).toBe(2);
    
    // tool_timeout_ms should respect TIMEOUTS constants
    expect(TIMEOUTS.TOOL.MIN).toBe(1000);
    expect(TIMEOUTS.TOOL.MAX).toBe(300000);
  });
});

describe("Configuration Type Conversion", () => {
  beforeEach(() => {
    try {
      closeDB();
    } catch {
      // Not initialized
    }
    initDB(":memory:");
  });

  test("getNumber should parse string to number", () => {
    set("max_iterations", "42");
    expect(getNumber("max_iterations")).toBe(42);
    expect(typeof getNumber("max_iterations")).toBe("number");
  });

  test("getNumber should return 0 for undefined", () => {
    expect(getNumber("nonexistent_key")).toBe(0);
  });

  test("getBool should parse string to boolean", () => {
    set("verbose", "true");
    expect(getBool("verbose")).toBe(true);
    
    set("verbose", "false");
    expect(getBool("verbose")).toBe(false);
  });

  test("getBool should return false for undefined", () => {
    expect(getBool("nonexistent_key")).toBe(false);
  });

  test("get should return undefined for non-existent keys", () => {
    expect(get("nonexistent_key")).toBeUndefined();
  });
});

describe("Configuration Edge Cases", () => {
  beforeEach(() => {
    try {
      closeDB();
    } catch {
      // Not initialized
    }
    initDB(":memory:");
  });

  test("should update existing values", () => {
    set("max_iterations", "50");
    expect(get("max_iterations")).toBe("50");
    
    set("max_iterations", "75");
    expect(get("max_iterations")).toBe("75");
  });
});
