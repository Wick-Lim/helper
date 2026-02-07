// SQLite singleton with WAL mode and automatic migrations

import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema.js";
import { logger } from "../core/logger.js";

let db: Database | null = null;

export function initDB(dbPath: string = "/data/agent.db"): Database {
  if (db) return db;

  logger.info(`Initializing database at ${dbPath}`);

  db = new Database(dbPath, { create: true });

  // Performance pragmas
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA cache_size = -20000"); // 20MB cache
  db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  for (const migration of MIGRATIONS) {
    db.run(migration);
  }

  logger.info("Database initialized successfully");
  return db;
}

export function getDB(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDB() first.");
  }
  return db;
}

export function closeDB(): void {
  if (db) {
    logger.info("Closing database...");
    try {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore checkpoint errors during shutdown
    }
    db.close();
    db = null;
  }
}
