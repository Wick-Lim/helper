// Constants validation tests
// Ensures all constants are properly defined and consistent

import { describe, test, expect } from "bun:test";
import {
  MAX_ITERATIONS,
  THINKING_BUDGET,
  TIMEOUTS,
  LIMITS,
  LENGTHS,
  RATE_LIMITS,
  RETRY,
  GENERATION,
  STUCK_DETECTION,
  ALLOWED_DIRECTORIES,
  SCREENSHOT,
  HTTP_STATUS,
  MIME_TYPES,
} from "../src/core/constants.js";

describe("Constants Validation", () => {
  describe("MAX_ITERATIONS", () => {
    test("should have valid defaults", () => {
      expect(MAX_ITERATIONS.DEFAULT).toBe(100);
      expect(MAX_ITERATIONS.MIN).toBe(1);
      expect(MAX_ITERATIONS.MAX).toBe(1000);
    });

    test("should maintain valid range", () => {
      expect(MAX_ITERATIONS.MIN).toBeLessThan(MAX_ITERATIONS.DEFAULT);
      expect(MAX_ITERATIONS.DEFAULT).toBeLessThan(MAX_ITERATIONS.MAX);
    });
  });

  describe("TIMEOUTS", () => {
    test("should have valid tool timeouts", () => {
      expect(TIMEOUTS.TOOL.DEFAULT).toBe(30000);
      expect(TIMEOUTS.TOOL.MIN).toBe(1000);
      expect(TIMEOUTS.TOOL.MAX).toBe(300000);
      
      expect(TIMEOUTS.TOOL.MIN).toBeLessThan(TIMEOUTS.TOOL.DEFAULT);
      expect(TIMEOUTS.TOOL.DEFAULT).toBeLessThan(TIMEOUTS.TOOL.MAX);
    });

    test("should have valid browser timeouts", () => {
      expect(TIMEOUTS.BROWSER.NAVIGATION).toBe(30000);
      expect(TIMEOUTS.BROWSER.IDLE_PAGE_CLOSE).toBe(300000);
      expect(TIMEOUTS.BROWSER.BROWSER_RESTART).toBe(1800000);
    });
  });

  describe("LIMITS", () => {
    test("should have reasonable file size limits", () => {
      expect(LIMITS.FILE_SIZE.MAX).toBe(50 * 1024 * 1024);
      expect(LIMITS.RESPONSE_SIZE.MAX).toBe(10 * 1024 * 1024);
    });

    test("should have valid screenshot limits", () => {
      expect(LIMITS.SCREENSHOTS.MAX_COUNT).toBe(100);
      expect(LIMITS.SCREENSHOTS.MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("RATE_LIMITS", () => {
    test("should have valid Gemini limits", () => {
      expect(RATE_LIMITS.GEMINI.REQUESTS_PER_MINUTE).toBe(30);
      expect(RATE_LIMITS.GEMINI.MAX_TOKENS).toBe(30);
    });

    test("should have valid web request limits", () => {
      expect(RATE_LIMITS.WEB.REQUESTS_PER_MINUTE).toBe(100);
      expect(RATE_LIMITS.WEB.DELAY_MS).toBe(1000);
    });
  });

  describe("GENERATION", () => {
    test("should have valid temperature range", () => {
      expect(GENERATION.TEMPERATURE.MIN).toBe(0);
      expect(GENERATION.TEMPERATURE.MAX).toBe(2);
      expect(GENERATION.TEMPERATURE.DEFAULT).toBe(0.7);
    });
  });

  describe("STUCK_DETECTION", () => {
    test("should have valid thresholds", () => {
      expect(STUCK_DETECTION.SAME_CALL_THRESHOLD).toBe(3);
      expect(STUCK_DETECTION.SINGLE_TOOL_THRESHOLD).toBe(10);
    });
  });

  describe("ALLOWED_DIRECTORIES", () => {
    test("should define allowed shell directories", () => {
      expect(ALLOWED_DIRECTORIES.SHELL).toContain("/workspace");
      expect(ALLOWED_DIRECTORIES.SHELL).toContain("/tmp");
    });

    test("should define allowed file directories", () => {
      expect(ALLOWED_DIRECTORIES.FILE).toContain("/workspace");
      expect(ALLOWED_DIRECTORIES.FILE).toContain("/tmp");
      expect(ALLOWED_DIRECTORIES.FILE).toContain("/data/screenshots");
    });
  });

  describe("SCREENSHOT", () => {
    test("should have valid screenshot configuration", () => {
      expect(SCREENSHOT.DIR).toBe("/data/screenshots");
      expect(SCREENSHOT.FORMAT).toBe("jpeg");
      expect(SCREENSHOT.QUALITY).toBe(80);
      expect(SCREENSHOT.ENCODING).toBe("base64");
    });
  });

  describe("HTTP_STATUS", () => {
    test("should have standard HTTP status codes", () => {
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.FORBIDDEN).toBe(403);
      expect(HTTP_STATUS.NOT_FOUND).toBe(404);
      expect(HTTP_STATUS.RATE_LIMITED).toBe(429);
      expect(HTTP_STATUS.SERVER_ERROR).toBe(500);
    });
  });

  describe("MIME_TYPES", () => {
    test("should define image types", () => {
      expect(MIME_TYPES.png).toBe("image/png");
      expect(MIME_TYPES.jpg).toBe("image/jpeg");
      expect(MIME_TYPES.jpeg).toBe("image/jpeg");
    });

    test("should define video types", () => {
      expect(MIME_TYPES.mp4).toBe("video/mp4");
      expect(MIME_TYPES.webm).toBe("video/webm");
    });

    test("should define audio types", () => {
      expect(MIME_TYPES.mp3).toBe("audio/mpeg");
      expect(MIME_TYPES.wav).toBe("audio/wav");
    });

    test("should define document types", () => {
      expect(MIME_TYPES.pdf).toBe("application/pdf");
      expect(MIME_TYPES.json).toBe("application/json");
    });
  });

  describe("Constants Consistency", () => {
    test("timeout defaults should be within valid ranges", () => {
      expect(TIMEOUTS.TOOL.DEFAULT).toBeGreaterThanOrEqual(TIMEOUTS.TOOL.MIN);
      expect(TIMEOUTS.TOOL.DEFAULT).toBeLessThanOrEqual(TIMEOUTS.TOOL.MAX);
    });

    test("temperature default should be within range", () => {
      expect(GENERATION.TEMPERATURE.DEFAULT).toBeGreaterThanOrEqual(GENERATION.TEMPERATURE.MIN);
      expect(GENERATION.TEMPERATURE.DEFAULT).toBeLessThanOrEqual(GENERATION.TEMPERATURE.MAX);
    });

    test("max iterations default should be within range", () => {
      expect(MAX_ITERATIONS.DEFAULT).toBeGreaterThanOrEqual(MAX_ITERATIONS.MIN);
      expect(MAX_ITERATIONS.DEFAULT).toBeLessThanOrEqual(MAX_ITERATIONS.MAX);
    });
  });
});

describe("Constants Usage Verification", () => {
  test("all constants should be defined as const assertions", () => {
    // Ensure const assertion is used (readonly at type level)
    const testMaxIterations: 100 = MAX_ITERATIONS.DEFAULT;
    expect(testMaxIterations).toBe(100);
  });

  test("directory arrays should not be empty", () => {
    expect(ALLOWED_DIRECTORIES.SHELL.length).toBeGreaterThan(0);
    expect(ALLOWED_DIRECTORIES.FILE.length).toBeGreaterThan(0);
  });

  test("MIME types should cover common formats", () => {
    const requiredTypes = ["png", "jpg", "pdf", "json", "txt"];
    for (const type of requiredTypes) {
      expect(MIME_TYPES[type]).toBeDefined();
    }
  });
});
