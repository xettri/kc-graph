import type { CodeGraph } from '../core/graph.js';
import type { SimilarityResult } from '../core/types.js';

/**
 * Compute cosine similarity between two Float32Array vectors.
 *
 * V8-optimized: manual loop with accumulator variables.
 * Float32Array enables potential SIMD optimization by V8's TurboFan.
 * We process 4 elements per iteration (loop unrolling) for better
 * instruction-level parallelism.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  const len = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  // Process 4 elements per iteration (loop unrolling)
  const limit = len - (len % 4);
  let i = 0;

  for (; i < limit; i += 4) {
    const a0 = a[i]!;
    const a1 = a[i + 1]!;
    const a2 = a[i + 2]!;
    const a3 = a[i + 3]!;
    const b0 = b[i]!;
    const b1 = b[i + 1]!;
    const b2 = b[i + 2]!;
    const b3 = b[i + 3]!;

    dot += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
    normA += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
    normB += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
  }

  // Handle remaining elements
  for (; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * Find the k most similar nodes to a query embedding.
 * Uses brute-force cosine similarity (no external index required).
 *
 * For typical code graph sizes (<100k nodes), brute force on Float32Arrays
 * is fast enough (< 50ms for 100k vectors of dimension 384).
 */
export function findSimilar(
  graph: CodeGraph,
  queryEmbedding: Float32Array,
  k: number,
  threshold: number = 0,
): SimilarityResult[] {
  const results: SimilarityResult[] = [];

  for (const node of graph.allNodes()) {
    if (!node.embedding) continue;

    const score = cosineSimilarity(queryEmbedding, node.embedding);
    if (score >= threshold) {
      results.push({ node, score });
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);

  // Return top-k
  return results.slice(0, k);
}

/**
 * Set embedding for a node identified by name/file (consumer-friendly API).
 */
export function setEmbedding(
  graph: CodeGraph,
  identifier: string,
  embedding: Float32Array,
  file?: string,
): boolean {
  const node = graph.resolve(identifier, file);
  if (!node) return false;
  graph.updateNode(node.id, { embedding });
  return true;
}

/**
 * Batch set embeddings for multiple nodes.
 * Accepts a map of identifier → embedding.
 */
export function setEmbeddings(
  graph: CodeGraph,
  embeddings: Map<string, Float32Array>,
): number {
  let count = 0;
  for (const [identifier, embedding] of embeddings) {
    const node = graph.resolve(identifier);
    if (node) {
      graph.updateNode(node.id, { embedding });
      count++;
    }
  }
  return count;
}
