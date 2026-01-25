import type { CodeGraph } from '../core/graph.js';
import type { CodeNode, EdgeType, TraversalOptions } from '../core/types.js';

/**
 * Breadth-first traversal from a starting node.
 * Generator-based for lazy evaluation — stops when consumer stops iterating.
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
  const queue: Array<{ id: string; depth: number; parentId: string | null }> = [];

  visited.add(startId);
  queue.push({ id: startId, depth: 0, parentId: null });

  let head = 0; // Array-based queue avoids shift() O(n) cost

  while (head < queue.length) {
    const current = queue[head++]!;

    const node = graph.getNode(current.id);
    if (!node) continue;

    yield { node, depth: current.depth, parentId: current.parentId };

    if (current.depth >= maxDepth) continue;

    const neighbors = getDirectedNeighborIds(graph, current.id, direction, edgeTypes);

    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ id: neighborId, depth: current.depth + 1, parentId: current.id });
      }
    }
  }
}

/**
 * Depth-first traversal from a starting node.
 * Generator-based for lazy evaluation.
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
  const stack: Array<{ id: string; depth: number; parentId: string | null }> = [];

  stack.push({ id: startId, depth: 0, parentId: null });

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (visited.has(current.id)) continue;
    visited.add(current.id);

    const node = graph.getNode(current.id);
    if (!node) continue;

    yield { node, depth: current.depth, parentId: current.parentId };

    if (current.depth >= maxDepth) continue;

    const neighbors = getDirectedNeighborIds(graph, current.id, direction, edgeTypes);

    // Push in reverse order so that first neighbor is processed first
    for (let i = neighbors.length - 1; i >= 0; i--) {
      const neighborId = neighbors[i]!;
      if (!visited.has(neighborId)) {
        stack.push({ id: neighborId, depth: current.depth + 1, parentId: current.id });
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

/** Helper: get neighbor IDs in the specified direction. */
function getDirectedNeighborIds(
  graph: CodeGraph,
  nodeId: string,
  direction: 'outbound' | 'inbound' | 'both',
  edgeTypes?: EdgeType[],
): string[] {
  const ids: string[] = [];

  if (direction === 'outbound' || direction === 'both') {
    const edges = graph.getOutEdges(nodeId, edgeTypes);
    for (const edge of edges) {
      ids.push(edge.target);
    }
  }

  if (direction === 'inbound' || direction === 'both') {
    const edges = graph.getInEdges(nodeId, edgeTypes);
    for (const edge of edges) {
      ids.push(edge.source);
    }
  }

  return ids;
}
