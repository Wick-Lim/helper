// SQLite singleton with WAL mode and automatic migrations

import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema.js";
import { logger } from "../core/logger.js";
import { DB } from "../core/constants.js";

let db: Database | null = null;

/**
 * Initialize the SQLite database with performance optimizations
 * @param dbPath - Path to the database file (default: /data/agent.db)
 * @returns The initialized Database instance
 * @throws Error if initialization fails
 */
export function initDB(dbPath: string = DB.PATHS.DEFAULT): Database {
  if (db) return db;

  logger.info(`Initializing database at ${dbPath}`);

  db = new Database(dbPath, { create: true });

  // Performance pragmas
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run(`PRAGMA busy_timeout = ${DB.BUSY_TIMEOUT}`);
  db.run(`PRAGMA cache_size = ${DB.CACHE_SIZE}`); // 20MB cache (negative = KB)
  db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  for (const migration of MIGRATIONS) {
    db.run(migration);
  }

  logger.info("Database initialized successfully");
  return db;
}

/**
 * Get the database instance
 * @returns The current Database instance
 * @throws Error if database has not been initialized
 */
export function getDB(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDB() first.");
  }
  return db;
}

/**
 * Check if database is initialized
 * @returns True if database is initialized
 */
export function isDBInitialized(): boolean {
  return db !== null;
}

/**
 * Close the database connection gracefully
 * Performs WAL checkpoint before closing to ensure data integrity
 */
export function closeDB(): void {
  if (db) {
    logger.info("Closing database...");
    try {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Ignore checkpoint errors during shutdown
    }
    db.close();
    db = null;
    logger.info("Database closed");
  }
}

/**
 * Execute a function within a database transaction
 * Automatically handles commit/rollback
 * @param fn - Function to execute within transaction
 * @returns Result of the function
 * @throws Error if transaction fails
 */
export function withTransaction<T>(fn: () => T): T {
  const database = getDB();
  database.run("BEGIN TRANSACTION");

  try {
    const result = fn();
    database.run("COMMIT");
    return result;
  } catch (error) {
    database.run("ROLLBACK");
    throw error;
  }
}

/**
 * Get database statistics
 * @returns Object containing database statistics
 */
export function getDBStats(): {
  isInitialized: boolean;
  cacheSize: number;
  busyTimeout: number;
} {
  return {
    isInitialized: isDBInitialized(),
    cacheSize: DB.CACHE_SIZE,
    busyTimeout: DB.BUSY_TIMEOUT,
  };
}
