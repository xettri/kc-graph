import type { CodeGraph } from '../core/graph.js';
import type { CodeNode, EdgeType, TraversalOptions } from '../core/types.js';

/**
 * Breadth-first traversal from a starting node.
 * Generator-based for lazy evaluation — stops when consumer stops iterating.
 *
 * V8-optimized: uses parallel arrays instead of object-per-queue-entry,
 * reducing GC pressure from O(V) object allocations to zero.
 * Only one result object is yielded at a time (reusable shape).
 */
export function* bfs(
  graph: CodeGraph,
  startId: string,
  options: TraversalOptions = {},
): Generator<{ node: CodeNode; depth: number; parentId: string | null }> {
  const maxDepth = options.maxDepth ?? Infinity;
  const direction = options.direction ?? 'outbound';
  const edgeTypes = options.edgeTypes;

  const visited = new Set<string>();

  // Parallel arrays: avoids allocating an object per queue entry
  const qIds: string[] = [startId];
  const qDepths: number[] = [0];
  const qParents: (string | null)[] = [null];

  visited.add(startId);

  let head = 0;

  while (head < qIds.length) {
    const id = qIds[head]!;
    const depth = qDepths[head]!;
    const parentId = qParents[head]!;
    head++;

    const node = graph.getNode(id);
    if (!node) continue;

    yield { node, depth, parentId };

    if (depth >= maxDepth) continue;

    const nextDepth = depth + 1;
    const neighbors = getDirectedNeighborIds(graph, id, direction, edgeTypes);

    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        qIds.push(neighborId);
        qDepths.push(nextDepth);
        qParents.push(id);
      }
    }
  }
}

/**
 * Depth-first traversal from a starting node.
 * Generator-based for lazy evaluation.
 *
 * V8-optimized: parallel arrays for stack instead of object-per-entry.
 */
export function* dfs(
  graph: CodeGraph,
  startId: string,
  options: TraversalOptions = {},
): Generator<{ node: CodeNode; depth: number; parentId: string | null }> {
  const maxDepth = options.maxDepth ?? Infinity;
  const direction = options.direction ?? 'outbound';
  const edgeTypes = options.edgeTypes;

  const visited = new Set<string>();

  // Parallel arrays for stack
  const sIds: string[] = [startId];
  const sDepths: number[] = [0];
  const sParents: (string | null)[] = [null];

  while (sIds.length > 0) {
    const id = sIds.pop()!;
    const depth = sDepths.pop()!;
    const parentId = sParents.pop()!;

    if (visited.has(id)) continue;
    visited.add(id);

    const node = graph.getNode(id);
    if (!node) continue;

    yield { node, depth, parentId };

    if (depth >= maxDepth) continue;

    const nextDepth = depth + 1;
    const neighbors = getDirectedNeighborIds(graph, id, direction, edgeTypes);

    // Push in reverse order so that first neighbor is processed first
    for (let i = neighbors.length - 1; i >= 0; i--) {
      const neighborId = neighbors[i]!;
      if (!visited.has(neighborId)) {
        sIds.push(neighborId);
        sDepths.push(nextDepth);
        sParents.push(id);
      }
    }
  }
}

/**
 * Collect all nodes reachable within k hops from a set of seed nodes.
 */
export function kHopNeighborhood(
  graph: CodeGraph,
  seedIds: string[],
  k: number,
  edgeTypes?: EdgeType[],
): CodeNode[] {
  const visited = new Set<string>();
  const result: CodeNode[] = [];

  for (const seedId of seedIds) {
    for (const { node } of bfs(graph, seedId, { maxDepth: k, edgeTypes, direction: 'both' })) {
      if (!visited.has(node.id)) {
        visited.add(node.id);
        result.push(node);
      }
    }
  }

  return result;
}

/**
 * Get neighbor IDs using direct ID accessors that skip CodeEdge[] allocation.
 * Falls back to outbound-only or inbound-only arrays to avoid merging when possible.
 */
function getDirectedNeighborIds(
  graph: CodeGraph,
  nodeId: string,
  direction: 'outbound' | 'inbound' | 'both',
  edgeTypes?: EdgeType[],
): string[] {
  if (direction === 'outbound') {
    return graph.getOutNeighborIds(nodeId, edgeTypes);
  }
  if (direction === 'inbound') {
    return graph.getInNeighborIds(nodeId, edgeTypes);
  }
  // 'both' — merge; reuse outbound array to avoid extra allocation
  const outIds = graph.getOutNeighborIds(nodeId, edgeTypes);
  const inIds = graph.getInNeighborIds(nodeId, edgeTypes);
  if (inIds.length === 0) return outIds;
  if (outIds.length === 0) return inIds;
  for (let i = 0; i < inIds.length; i++) {
    outIds.push(inIds[i]!);
  }
  return outIds;
}
