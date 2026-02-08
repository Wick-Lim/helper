// Database schema DDL — migration statements

export const MIGRATIONS: string[] = [
  // Migration 1: Core tables
  `CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    importance INTEGER DEFAULT 5,
    access_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT DEFAULT 'running' CHECK(status IN ('running','completed','failed','stuck')),
    result TEXT,
    iterations INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    tool_name TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1,
    execution_time_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // Migration 2: Survival & Growth
  `CREATE TABLE IF NOT EXISTS survival_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL, -- negative for debt, positive for income
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS thoughts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL, -- Full inner monologue
    summary TEXT, -- Korean summary for UI
    category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT,
    importance INTEGER DEFAULT 5, -- 1-10
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // Vector table (requires sqlite-vec)
  `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
    id INTEGER PRIMARY KEY,
    vector FLOAT[384]
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id)`,
];
