import type { CodeGraph } from '../core/graph.js';
import type { CodeNode, EdgeType } from '../core/types.js';
import { cosineSimilarity } from './embeddings.js';

/**
 * Weights for different scoring components.
 * Pre-tuned for code intelligence use cases.
 */
export interface RelevanceWeights {
  /** Weight for graph distance (closer = more relevant). Default: 0.4 */
  distance: number;
  /** Weight for edge type priority. Default: 0.3 */
  edgeType: number;
  /** Weight for embedding similarity. Default: 0.3 */
  embedding: number;
}

const DEFAULT_WEIGHTS: RelevanceWeights = {
  distance: 0.4,
  edgeType: 0.3,
  embedding: 0.3,
};

/**
 * Priority of edge types for relevance scoring.
 * Higher = stronger signal of relevance.
 */
const EDGE_TYPE_PRIORITY: Record<EdgeType, number> = {
  contains: 1.0,
  calls: 0.9,
  imports: 0.8,
  extends: 0.85,
  implements: 0.85,
  references: 0.7,
  exports: 0.6,
  depends_on: 0.75,
  documents: 0.5,
  tagged_with: 0.3,
};

/**
 * Compute a unified relevance score for a candidate node relative to a seed.
 *
 * Combines:
 * 1. Distance decay: 1 / (1 + distance) — closer nodes score higher
 * 2. Edge type priority — structural relationships (contains, calls) rank above tags
 * 3. Embedding similarity — semantic closeness (when embeddings are available)
 */
export function scoreRelevance(
  seedNode: CodeNode,
  candidateNode: CodeNode,
  distance: number,
  edgeType: EdgeType | null,
  weights: RelevanceWeights = DEFAULT_WEIGHTS,
): number {
  // Distance component: inverse decay
  const distanceScore = 1 / (1 + distance);

  // Edge type component
  const edgeScore = edgeType ? (EDGE_TYPE_PRIORITY[edgeType] ?? 0.5) : 0.5;

  // Embedding component
  let embeddingScore = 0.5; // neutral default when no embeddings
  if (seedNode.embedding && candidateNode.embedding) {
    embeddingScore = Math.max(0, cosineSimilarity(seedNode.embedding, candidateNode.embedding));
  }

  return (
    weights.distance * distanceScore +
    weights.edgeType * edgeScore +
    weights.embedding * embeddingScore
  );
}

/**
 * Score and rank all neighbors of seed nodes within a given depth.
 * Returns nodes sorted by relevance score (descending).
 */
export function rankByRelevance(
  graph: CodeGraph,
  seedIds: string[],
  maxDepth: number = 3,
  weights: RelevanceWeights = DEFAULT_WEIGHTS,
): Array<{ node: CodeNode; score: number }> {
  const scored = new Map<string, { node: CodeNode; score: number }>();

  for (const seedId of seedIds) {
    const seedNode = graph.getNode(seedId);
    if (!seedNode) continue;

    // BFS to collect scored neighbors
    const visited = new Set<string>();
    visited.add(seedId);

    const queue: Array<{ id: string; depth: number; edgeType: EdgeType | null }> = [];

    // Seed outbound edges
    for (const edge of graph.getOutEdges(seedId)) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({ id: edge.target, depth: 1, edgeType: edge.type });
      }
    }
    // Seed inbound edges
    for (const edge of graph.getInEdges(seedId)) {
      if (!visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push({ id: edge.source, depth: 1, edgeType: edge.type });
      }
    }

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++]!;
      const node = graph.getNode(current.id);
      if (!node) continue;

      const score = scoreRelevance(seedNode, node, current.depth, current.edgeType, weights);

      const existing = scored.get(node.id);
      if (!existing || score > existing.score) {
        scored.set(node.id, { node, score });
      }

      if (current.depth < maxDepth) {
        for (const edge of graph.getOutEdges(current.id)) {
          if (!visited.has(edge.target)) {
            visited.add(edge.target);
            queue.push({ id: edge.target, depth: current.depth + 1, edgeType: edge.type });
          }
        }
        for (const edge of graph.getInEdges(current.id)) {
          if (!visited.has(edge.source)) {
            visited.add(edge.source);
            queue.push({ id: edge.source, depth: current.depth + 1, edgeType: edge.type });
          }
        }
      }
    }
  }

  // Remove seeds from results
  for (const seedId of seedIds) {
    scored.delete(seedId);
  }

  const result = [...scored.values()];
  result.sort((a, b) => b.score - a.score);
  return result;
}
