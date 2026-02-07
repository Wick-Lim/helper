// Agent memory CRUD + search + context assembly + pruning

import { getDB } from "./index.js";
import type { MemoryRow } from "../core/types.js";

export function saveMemory(
  key: string,
  value: string,
  category: string = "general",
  importance: number = 5
): void {
  const db = getDB();
  db.run(
    `INSERT INTO memory (key, value, category, importance)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       category = excluded.category,
       importance = excluded.importance,
       updated_at = datetime('now')`,
    [key, value, category, importance]
  );
}

export function getMemory(key: string): MemoryRow | null {
  const db = getDB();
  const row = db.query("SELECT * FROM memory WHERE key = ?").get(key) as MemoryRow | null;
  if (row) {
    db.run("UPDATE memory SET access_count = access_count + 1 WHERE key = ?", [key]);
  }
  return row;
}

export function searchMemory(query: string, limit: number = 10): MemoryRow[] {
  const db = getDB();
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (keywords.length === 0) {
    return db.query(
      "SELECT * FROM memory ORDER BY importance DESC, updated_at DESC LIMIT ?"
    ).all(limit) as MemoryRow[];
  }

  // Simple keyword-based relevance scoring
  const allRows = db.query("SELECT * FROM memory").all() as MemoryRow[];
  const scored = allRows.map((row) => {
    const text = `${row.key} ${row.value} ${row.category}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 1;
    }
    // Weight by importance and access patterns
    score += row.importance * 0.1;
    score += Math.log(row.access_count + 1) * 0.2;
    return { row, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.row);
}

export function listMemory(category?: string, limit: number = 50): MemoryRow[] {
  const db = getDB();
  if (category) {
    return db.query(
      "SELECT * FROM memory WHERE category = ? ORDER BY updated_at DESC LIMIT ?"
    ).all(category, limit) as MemoryRow[];
  }
  return db.query(
    "SELECT * FROM memory ORDER BY updated_at DESC LIMIT ?"
  ).all(limit) as MemoryRow[];
}

export function deleteMemory(key: string): boolean {
  const db = getDB();
  const result = db.run("DELETE FROM memory WHERE key = ?", [key]);
  return result.changes > 0;
}

export function buildMemoryContext(query: string): string {
  const memories = searchMemory(query, 5);
  if (memories.length === 0) return "";

  const lines = memories.map(
    (m) => `[${m.category}] ${m.key}: ${m.value}`
  );
  return `\n--- Relevant Memories ---\n${lines.join("\n")}\n---\n`;
}

export function pruneMemory(maxEntries: number = 1000): number {
  const db = getDB();
  const count = (
    db.query("SELECT COUNT(*) as cnt FROM memory").get() as { cnt: number }
  ).cnt;

  if (count <= maxEntries) return 0;

  const toDelete = count - maxEntries;
  db.run(
    `DELETE FROM memory WHERE id IN (
      SELECT id FROM memory
      ORDER BY importance ASC, access_count ASC, updated_at ASC
      LIMIT ?
    )`,
    [toDelete]
  );
  return toDelete;
}
