// Runtime configuration KV with hardcoded defaults + SQLite overrides
// Includes validation for security and correctness

import { getDB } from "./index.js";
import { logger } from "../core/logger.js";

export const DEFAULTS: Record<string, string> = {
  max_iterations: "100",
  thinking_budget: "10000",
  tool_timeout_ms: "30000",
  code_timeout_ms: "60000",
  max_output_chars: "10000",
  verbose: "false",
  model: "gemini-2.5-flash",
  temperature: "0.7",
};

// Validation rules for each config key
interface ValidationRule {
  type: "number" | "boolean" | "string" | "enum";
  min?: number;
  max?: number;
  allowed?: string[];
  pattern?: RegExp;
}

const VALIDATION_RULES: Record<string, ValidationRule> = {
  max_iterations: { type: "number", min: 1, max: 1000 },
  thinking_budget: { type: "number", min: 0, max: 100000 },
  tool_timeout_ms: { type: "number", min: 1000, max: 600000 }, // 1s to 10min
  code_timeout_ms: { type: "number", min: 1000, max: 600000 },
  max_output_chars: { type: "number", min: 1000, max: 100000 },
  verbose: { type: "boolean" },
  model: { type: "string", pattern: /^gemini-[a-z0-9.-]+$/i },
  temperature: { type: "number", min: 0, max: 2 },
};

function validateValue(key: string, value: string): { valid: boolean; sanitized?: string; reason?: string } {
  const rule = VALIDATION_RULES[key];
  if (!rule) {
    // Unknown key - allow but log warning
    logger.warn(`Unknown config key "${key}" - no validation rules defined`);
    return { valid: true };
  }

  switch (rule.type) {
    case "number": {
      const num = Number(value);
      if (isNaN(num)) {
        return { valid: false, reason: `Value for "${key}" must be a number` };
      }
      if (rule.min !== undefined && num < rule.min) {
        return {
          valid: false,
          sanitized: String(rule.min),
          reason: `Value for "${key}" (${num}) is below minimum (${rule.min})`,
        };
      }
      if (rule.max !== undefined && num > rule.max) {
        return {
          valid: false,
          sanitized: String(rule.max),
          reason: `Value for "${key}" (${num}) exceeds maximum (${rule.max})`,
        };
      }
      return { valid: true };
    }

    case "boolean": {
      if (value !== "true" && value !== "false" && value !== "1" && value !== "0") {
        return {
          valid: false,
          sanitized: "false",
          reason: `Value for "${key}" must be "true", "false", "1", or "0"`,
        };
      }
      return { valid: true };
    }

    case "string": {
      if (rule.pattern && !rule.pattern.test(value)) {
        return {
          valid: false,
          reason: `Value for "${key}" does not match required pattern: ${rule.pattern.source}`,
        };
      }
      return { valid: true };
    }

    case "enum": {
      if (rule.allowed && !rule.allowed.includes(value)) {
        return {
          valid: false,
          reason: `Value for "${key}" must be one of: ${rule.allowed.join(", ")}`,
        };
      }
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}

export function get(key: string): string | undefined {
  try {
    const db = getDB();
    const row = db.query("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | null;
    const value = row?.value ?? DEFAULTS[key];

    // Validate the value
    if (value !== undefined) {
      const validation = validateValue(key, value);
      if (!validation.valid) {
        logger.warn(`Config validation failed for "${key}": ${validation.reason}`);
        // Return sanitized value if available, otherwise return default
        return validation.sanitized ?? DEFAULTS[key];
      }
    }

    return value;
  } catch {
    return DEFAULTS[key];
  }
}

export function getNumber(key: string): number {
  const val = get(key);
  return val !== undefined ? Number(val) : 0;
}

export function getBool(key: string): boolean {
  const val = get(key);
  return val === "true" || val === "1";
}

export function set(key: string, value: string): void {
  // Validate before setting
  const validation = validateValue(key, value);
  if (!validation.valid) {
    logger.error(`Cannot set config "${key}"="${value}": ${validation.reason}`);
    throw new Error(`Invalid config value: ${validation.reason}`);
  }

  const db = getDB();
  db.run(
    `INSERT INTO config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );

  logger.info(`Config updated: ${key}=${value}`);
}

export function remove(key: string): void {
  // Prevent removal of critical defaults
  const criticalKeys = ["max_iterations", "tool_timeout_ms"];
  if (criticalKeys.includes(key)) {
    logger.warn(`Cannot remove critical config key: ${key}`);
    throw new Error(`Cannot remove critical config key: ${key}`);
  }

  const db = getDB();
  db.run("DELETE FROM config WHERE key = ?", [key]);
  logger.info(`Config removed: ${key}`);
}

export function getAll(): Record<string, string> {
  const result = { ...DEFAULTS };
  try {
    const db = getDB();
    const rows = db.query("SELECT key, value FROM config").all() as Array<{
      key: string;
      value: string;
    }>;
    for (const row of rows) {
      // Validate before including
      const validation = validateValue(row.key, row.value);
      if (validation.valid) {
        result[row.key] = row.value;
      } else {
        logger.warn(`Invalid config "${row.key}" in database: ${validation.reason}`);
        // Use sanitized value or default
        result[row.key] = validation.sanitized ?? DEFAULTS[row.key] ?? row.value;
      }
    }
  } catch {
    // DB not initialized yet, return defaults
  }
  return result;
}

// Validate all config values and return any issues
export function validateAll(): Array<{ key: string; issue: string; current: string; suggested: string }> {
  const issues: Array<{ key: string; issue: string; current: string; suggested: string }> = [];
  const all = getAll();

  for (const [key, value] of Object.entries(all)) {
    const validation = validateValue(key, value);
    if (!validation.valid) {
      issues.push({
        key,
        issue: validation.reason || "Validation failed",
        current: value,
        suggested: validation.sanitized ?? DEFAULTS[key] ?? "",
      });
    }
  }

  return issues;
}

// Reset all config to defaults
export function resetToDefaults(): void {
  const db = getDB();
  db.run("DELETE FROM config");
  logger.info("All config reset to defaults");
}
