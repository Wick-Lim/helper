// Runtime configuration KV with hardcoded defaults + SQLite overrides

import { getDB } from "./index.js";

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

export function get(key: string): string | undefined {
  try {
    const db = getDB();
    const row = db.query("SELECT value FROM config WHERE key = ?").get(key) as
      | { value: string }
      | null;
    return row?.value ?? DEFAULTS[key];
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
  const db = getDB();
  db.run(
    `INSERT INTO config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );
}

export function remove(key: string): void {
  const db = getDB();
  db.run("DELETE FROM config WHERE key = ?", [key]);
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
      result[row.key] = row.value;
    }
  } catch {
    // DB not initialized yet, return defaults
  }
  return result;
}
