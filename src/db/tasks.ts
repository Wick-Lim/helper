// Task execution history tracking

import { getDB } from "./index.js";
import type { TaskRow, ToolCallRow } from "../core/types.js";

export function createTask(sessionId: string, description: string): number {
  const db = getDB();
  const result = db.run(
    "INSERT INTO tasks (session_id, description) VALUES (?, ?)",
    [sessionId, description]
  );
  return Number(result.lastInsertRowid);
}

export function completeTask(taskId: number, result: string): void {
  const db = getDB();
  db.run(
    `UPDATE tasks SET status = 'completed', result = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [result, taskId]
  );
}

export function failTask(taskId: number, error: string): void {
  const db = getDB();
  db.run(
    `UPDATE tasks SET status = 'failed', result = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [error, taskId]
  );
}

export function markStuck(taskId: number, reason: string): void {
  const db = getDB();
  db.run(
    `UPDATE tasks SET status = 'stuck', result = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [reason, taskId]
  );
}

export function incrementIterations(taskId: number): void {
  const db = getDB();
  db.run("UPDATE tasks SET iterations = iterations + 1 WHERE id = ?", [taskId]);
}

export function logToolCall(
  taskId: number,
  toolName: string,
  input: string,
  output: string,
  success: boolean,
  executionTimeMs: number
): void {
  const db = getDB();
  db.run(
    `INSERT INTO tool_calls (task_id, tool_name, input, output, success, execution_time_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [taskId, toolName, input, output, success ? 1 : 0, executionTimeMs]
  );
}

export function getTask(taskId: number): TaskRow | null {
  const db = getDB();
  return db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | null;
}

export function getRecentTasks(sessionId: string, limit: number = 10): TaskRow[] {
  const db = getDB();
  return db.query(
    "SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(sessionId, limit) as TaskRow[];
}

export function getTaskToolCalls(taskId: number): ToolCallRow[] {
  const db = getDB();
  return db.query(
    "SELECT * FROM tool_calls WHERE task_id = ? ORDER BY created_at ASC"
  ).all(taskId) as ToolCallRow[];
}

// Conversation persistence
export function saveConversation(sessionId: string, role: string, content: string): void {
  const db = getDB();
  db.run(
    "INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)",
    [sessionId, role, content]
  );
}

export function getConversationHistory(sessionId: string, limit: number = 50): Array<{ role: string; content: string }> {
  const db = getDB();
  return db.query(
    "SELECT role, content FROM conversations WHERE session_id = ? ORDER BY created_at ASC LIMIT ?"
  ).all(sessionId, limit) as Array<{ role: string; content: string }>;
}
