// Knowledge growth and vector memory management
// Handles storing, searching, and pruning of agent's learned information

import { getDB, isVectorEnabled } from "./index.js";
import { embed } from "../core/embeddings.ts";
import { logger } from "../core/logger.js";
import { GROWTH } from "../core/constants.js";

/**
 * Save a piece of learned knowledge to the database
 * Automatically generates vector embeddings if enabled
 */
export async function saveKnowledge(params: {
  content: string;
  summary: string;
  source?: string;
  importance?: number;
}): Promise<number> {
  const db = getDB();
  const importance = params.importance ?? 5;

  // 1. Save text to knowledge table
  const result = db.run(
    `INSERT INTO knowledge (content, summary, source, importance)
     VALUES (?, ?, ?, ?)`,
    [params.content, params.summary, params.source ?? null, importance]
  );

  const id = result.lastInsertRowid as number;

  // 2. Generate and save vector if enabled
  if (isVectorEnabled()) {
    try {
      const vector = await embed(params.content);
      const vectorBlob = new Uint8Array(new Float32Array(vector).buffer);

      db.run(
        `INSERT INTO knowledge_vec (id, vector) VALUES (?, ?)`,
        [id, vectorBlob]
      );
      logger.debug(`Knowledge saved with vector (ID: ${id})`);
    } catch (err) {
      logger.warn(`Failed to save vector for knowledge ${id}: ${err}`);
    }
  }

  // 3. Emit SSE event for timeline
  const knowledge = db.query("SELECT * FROM knowledge WHERE id = ?").get(id);
  if (knowledge) {
    const { timelineEvents } = require("../api/routes.js");
    const { randomUUID } = require("crypto");
    timelineEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify({ type: 'knowledge', ...knowledge })}\n\n`);
  }

  return id;
}

/**
 * Search knowledge using semantic vector similarity
 */
export async function searchKnowledge(query: string, limit: number = 5): Promise<any[]> {
  if (!isVectorEnabled()) {
    logger.warn('Vector search requested but sqlite-vec is not enabled');
    return [];
  }
  
  const db = getDB();
  
  try {
    const queryVector = await embed(query);
    const queryBlob = new Uint8Array(new Float32Array(queryVector).buffer);
    
    // Find nearest neighbors using sqlite-vec
    const rows = db.query(`
      SELECT 
        k.id, k.content, k.summary, k.source, k.importance,
        v.distance
      FROM knowledge_vec v
      JOIN knowledge k ON v.id = k.id
      WHERE v.vector MATCH ? AND k = ?
      ORDER BY v.distance
    `).all(queryBlob, limit) as any[];
    
    return rows;
  } catch (err) {
    logger.error(`Vector search failed: ${err}`);
    return [];
  }
}

/**
 * Prune low-importance knowledge when reaching capacity
 */
export function pruneKnowledge(): number {
  const db = getDB();
  const count = (db.query('SELECT COUNT(*) as cnt FROM knowledge').get() as any).cnt;
  
  if (count <= GROWTH.KNOWLEDGE_MAX_ENTRIES) return 0;
  
  const toDelete = count - GROWTH.KNOWLEDGE_MAX_ENTRIES;
  
  // Delete from vector table first (due to foreign key-like relationship)
  db.run(`
    DELETE FROM knowledge_vec 
    WHERE id IN (
      SELECT id FROM knowledge 
      ORDER BY importance ASC, created_at ASC 
      LIMIT ?
    )
  `, [toDelete]);
  
  // Delete from main table
  const result = db.run(`
    DELETE FROM knowledge 
    WHERE id IN (
      SELECT id FROM knowledge 
      ORDER BY importance ASC, created_at ASC 
      LIMIT ?
    )
  `, [toDelete]);
  
  logger.info(`Pruned ${result.changes} pieces of low-importance knowledge`);
  return result.changes;
}

/**
 * Save a thought/monologue to the database
 */
export function saveThought(params: {
  content: string;
  summary?: string;
  category?: string;
}): number {
  const db = getDB();
  const result = db.run(
    `INSERT INTO thoughts (content, summary, category)
     VALUES (?, ?, ?)`,
    [params.content, params.summary ?? null, params.category ?? 'general']
  );
  const thoughtId = result.lastInsertRowid as number;

  // Emit SSE event
  const thoughts = db.query("SELECT * FROM thoughts WHERE id = ?").get(thoughtId);
  if (thoughts) {
    // Lazy import to avoid circular dependency
    const { thoughtsEvents, timelineEvents } = require("../api/routes.js");
    const { randomUUID } = require("crypto");
    thoughtsEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify(thoughts)}\n\n`);
    timelineEvents?.emit("sse", `id: ${randomUUID()}\ndata: ${JSON.stringify({ type: 'thought', ...thoughts })}\n\n`);
  }

  return thoughtId;
}

/**
 * Prune old thoughts
 */
export function pruneThoughts(): number {
  const db = getDB();
  const result = db.run(`
    DELETE FROM thoughts 
    WHERE created_at < datetime('now', '-${GROWTH.THOUGHTS_RETENTION_DAYS} days')
  `);
  
  if (result.changes > 0) {
    logger.info(`Pruned ${result.changes} old thoughts`);
  }
  return result.changes;
}

/**
 * Get recent thoughts for SSE streaming
 */
export function getRecentThoughts(limit: number = 10, offset: number = 0): any[] {
  const db = getDB();
  return db.query(`
    SELECT id, summary, category, created_at, content
    FROM thoughts
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * Get unified timeline of thoughts, knowledge, and tasks
 * Returns items sorted by timestamp
 */
export function getTimeline(limit: number = 50, offset: number = 0): any[] {
  const db = getDB();

  // Union all three tables with type discriminator
  const items = db.query(`
    SELECT
      'thought' as type,
      id,
      content,
      summary,
      category as metadata,
      NULL as importance,
      NULL as status,
      created_at as timestamp
    FROM thoughts

    UNION ALL

    SELECT
      'knowledge' as type,
      id,
      content,
      summary,
      source as metadata,
      importance,
      NULL as status,
      created_at as timestamp
    FROM knowledge

    UNION ALL

    SELECT
      'task' as type,
      id,
      description as content,
      result as summary,
      session_id as metadata,
      NULL as importance,
      status,
      created_at as timestamp
    FROM tasks

    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  return items;
}
