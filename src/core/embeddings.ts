// Local embedding pipeline using transformers.js
// Provides semantic vectors for RAG (Retrieval-Augmented Generation)

import { pipeline, env } from '@xenova/transformers';
import { logger } from './logger.js';

// Configure transformers.js for container environment
env.allowLocalModels = false;
env.cacheDir = '/app/models-cache';

let embedder: any = null;

/**
 * Initialize the embedding model
 * Uses all-MiniLM-L6-v2 which produces 384-dimensional vectors
 */
export async function initEmbedder(): Promise<void> {
  if (embedder) return;
  
  try {
    logger.info('Initializing local embedding model...');
    // Use Xenova's distribution of all-MiniLM-L6-v2 (quantized)
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    logger.info('Embedding model initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize embedding model:', error);
    throw error;
  }
}

/**
 * Generate a vector for a given text
 * @param text - The text to embed
 * @returns Array of numbers representing the vector (384 dimensions)
 */
export async function embed(text: string): Promise<number[]> {
  if (!embedder) await initEmbedder();
  
  try {
    // Generate embeddings
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    
    // Extract data from Tensor
    return Array.from(output.data) as number[];
  } catch (error) {
    logger.error('Embedding generation failed:', error);
    throw error;
  }
}

/**
 * Compute cosine similarity between two vectors
 * Note: Since our vectors are normalized, dot product is equivalent to cosine similarity
 */
export function cosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i] * v2[i];
  }
  return dotProduct;
}
