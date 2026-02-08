// Task execution history tracking

import { getDB } from "./index.js";
import type { TaskRow, ToolCallRow } from "../core/types.js";
import { randomUUID } from "crypto";

// Import SSE emitters (lazy import to avoid circular dependency)
let tasksEvents: any = null;
let timelineEvents: any = null;

function getSSEEmitters() {
  if (!tasksEvents || !timelineEvents) {
    const routes = require("../api/routes.js");
    tasksEvents = routes.tasksEvents;
    timelineEvents = routes.timelineEvents;
  }
  return { tasksEvents, timelineEvents };
}

export function createTask(sessionId: string, description: string): number {
  const db = getDB();
  const result = db.run(
    "INSERT INTO tasks (session_id, description) VALUES (?, ?)",
    [sessionId, description]
  );
  const taskId = Number(result.lastInsertRowid);

  // Emit SSE event
  const task = getTask(taskId);
  if (task) {
    const { tasksEvents, timelineEvents } = getSSEEmitters();
    tasksEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(task)}\n\n`);

    // Transform task to match timeline structure (description → content, result → summary)
    const timelineItem = {
      type: 'task',
      id: task.id,
      content: task.description,
      summary: task.result,
      metadata: task.session_id,
      importance: null,
      status: task.status,
      timestamp: task.created_at
    };
    timelineEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(timelineItem)}\n\n`);
  }

  return taskId;
}

export function completeTask(taskId: number, result: string): void {
  const db = getDB();
  db.run(
    `UPDATE tasks SET status = 'completed', result = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [result, taskId]
  );

  // Emit SSE event
  const task = getTask(taskId);
  if (task) {
    const { tasksEvents, timelineEvents } = getSSEEmitters();
    tasksEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(task)}\n\n`);

    // Transform task to match timeline structure
    const timelineItem = {
      type: 'task',
      id: task.id,
      content: task.description,
      summary: task.result,
      metadata: task.session_id,
      importance: null,
      status: task.status,
      timestamp: task.created_at
    };
    timelineEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(timelineItem)}\n\n`);
  }
}

export function failTask(taskId: number, error: string): void {
  const db = getDB();
  db.run(
    `UPDATE tasks SET status = 'failed', result = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [error, taskId]
  );

  // Emit SSE event
  const task = getTask(taskId);
  if (task) {
    const { tasksEvents, timelineEvents } = getSSEEmitters();
    tasksEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(task)}\n\n`);

    // Transform task to match timeline structure
    const timelineItem = {
      type: 'task',
      id: task.id,
      content: task.description,
      summary: task.result,
      metadata: task.session_id,
      importance: null,
      status: task.status,
      timestamp: task.created_at
    };
    timelineEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(timelineItem)}\n\n`);
  }
}

export function markStuck(taskId: number, reason: string): void {
  const db = getDB();
  db.run(
    `UPDATE tasks SET status = 'stuck', result = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [reason, taskId]
  );

  // Emit SSE event
  const task = getTask(taskId);
  if (task) {
    const { tasksEvents, timelineEvents } = getSSEEmitters();
    tasksEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(task)}\n\n`);

    // Transform task to match timeline structure
    const timelineItem = {
      type: 'task',
      id: task.id,
      content: task.description,
      summary: task.result,
      metadata: task.session_id,
      importance: null,
      status: task.status,
      timestamp: task.created_at
    };
    timelineEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(timelineItem)}\n\n`);
  }
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

export function getConversationHistory(sessionId: string, limit: number = 100): Array<{ role: string; content: string; created_at: string }> {
  const db = getDB();
  return db.query(
    "SELECT role, content, created_at FROM conversations WHERE session_id = ? ORDER BY created_at ASC LIMIT ?"
  ).all(sessionId, limit) as Array<{ role: string; content: string; created_at: string }>;
}

/**
 * Prune old conversation history, keeping only the most recent N messages
 * This prevents context pollution from incorrect patterns
 */
export function pruneConversationHistory(sessionId: string, keepLast: number = 6): void {
  const db = getDB();

  // Delete all but the most recent N messages
  db.run(
    `DELETE FROM conversations
     WHERE session_id = ?
     AND id NOT IN (
       SELECT id FROM conversations
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?
     )`,
    [sessionId, sessionId, keepLast]
  );
}

// Get all conversation history across all sessions for unified feed
export function getAllConversationHistory(offset: number = 0, limit: number = 50, sessionId?: string): Array<{ session_id: string; role: string; content: string; created_at: string }> {
  const db = getDB();

  if (sessionId) {
    return db.query(`
      SELECT session_id, role, content, created_at
      FROM conversations
      WHERE session_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset) as Array<{ session_id: string; role: string; content: string; created_at: string }>;
  }

  return db.query(`
    SELECT session_id, role, content, created_at
    FROM conversations
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Array<{ session_id: string; role: string; content: string; created_at: string }>;
}

// Get all unique sessions with their latest message time
export function getSessions(limit: number = 20): Array<{ session_id: string; last_message_at: string; preview: string }> {
  const db = getDB();
  return db.query(`
    SELECT session_id, MAX(created_at) as last_message_at, content as preview
    FROM conversations
    GROUP BY session_id
    ORDER BY last_message_at DESC
    LIMIT ?
  `).all(limit) as Array<{ session_id: string; last_message_at: string; preview: string }>;
}

// Get all tasks (for WebUI)
export function getAllTasks(limit: number = 100, offset: number = 0): TaskRow[] {
  const db = getDB();
  return db.query(
    "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as TaskRow[];
}
