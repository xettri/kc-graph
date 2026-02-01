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
 * V8-optimized: uses a bounded min-heap of size k instead of collecting all
 * results and sorting. This reduces complexity from O(n log n) to O(n log k)
 * and avoids allocating an unbounded results array.
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
  // For small k, use a bounded min-heap: keep only the top-k highest scores.
  // The heap root is the *minimum* of the top-k, so we can quickly reject
  // candidates that can't make it into the result set.
  const heap: SimilarityResult[] = [];

  for (const node of graph.allNodes()) {
    if (!node.embedding) continue;

    const score = cosineSimilarity(queryEmbedding, node.embedding);
    if (score < threshold) continue;

    if (heap.length < k) {
      heap.push({ node, score });
      if (heap.length === k) heapify(heap); // build min-heap once full
    } else if (score > heap[0]!.score) {
      // Replace the min element and sift down
      heap[0] = { node, score };
      siftDown(heap, 0);
    }
  }

  // Extract in descending order
  heap.sort((a, b) => b.score - a.score);
  return heap;
}

// ---------------------------------------------------------------------------
// Min-heap helpers (by score ascending — root is smallest)
// ---------------------------------------------------------------------------

function heapify(h: SimilarityResult[]): void {
  for (let i = (h.length >> 1) - 1; i >= 0; i--) {
    siftDown(h, i);
  }
}

function siftDown(h: SimilarityResult[], i: number): void {
  const n = h.length;
  while (true) {
    let smallest = i;
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < n && h[l]!.score < h[smallest]!.score) smallest = l;
    if (r < n && h[r]!.score < h[smallest]!.score) smallest = r;
    if (smallest === i) break;
    const tmp = h[i]!;
    h[i] = h[smallest]!;
    h[smallest] = tmp;
    i = smallest;
  }
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
export function setEmbeddings(graph: CodeGraph, embeddings: Map<string, Float32Array>): number {
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
