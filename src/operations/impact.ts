import type { CodeGraph } from '../core/graph.js';
import type { EdgeType, ImpactResult, ImpactedNode } from '../core/types.js';

/** Default edge types considered for impact analysis. */
const DEFAULT_IMPACT_EDGES: EdgeType[] = [
  'calls',
  'imports',
  'depends_on',
  'references',
  'extends',
  'implements',
];

export interface ImpactOptions {
  /** Maximum traversal depth (default: 10). */
  maxDepth?: number;
  /** Edge types to follow (default: calls, imports, depends_on, references, extends, implements). */
  edgeTypes?: EdgeType[];
  /** Direction: 'dependents' traces who depends on this node, 'dependencies' traces what this node depends on. */
  direction?: 'dependents' | 'dependencies';
}

/**
 * Analyze the impact of changing a node.
 *
 * Traces through the graph following relationship edges to find all nodes
 * that would be affected by a change to the source node. Returns results
 * sorted by distance (closest = most impacted).
 *
 * V8-optimized: Uses parent-pointer chain instead of copying path arrays
 * at every BFS step. Paths are reconstructed on demand only for the final
 * result, reducing allocations from O(V × depth²) to O(V).
 */
export function analyzeImpact(
  graph: CodeGraph,
  nodeId: string,
  options: ImpactOptions = {},
): ImpactResult {
  const maxDepth = options.maxDepth ?? 10;
  const edgeTypes = options.edgeTypes ?? DEFAULT_IMPACT_EDGES;
  const direction = options.direction ?? 'dependents';

  const sourceNode = graph.getNode(nodeId);
  if (!sourceNode) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const visited = new Set<string>();
  visited.add(nodeId);

  // BFS using parallel arrays + parent pointers instead of object-per-entry.
  // This avoids O(depth) array copies per queue item ([...path, id]).
  const queueIds: string[] = [];
  const queueDepths: number[] = [];
  const queueParents: number[] = []; // index into queue, -1 = root
  const queueEdgeTypes: EdgeType[] = []; // edge type used to reach this node

  // Sentinel entry for the source node (index 0)
  queueIds.push(nodeId);
  queueDepths.push(0);
  queueParents.push(-1);
  queueEdgeTypes.push('calls'); // placeholder, unused

  // Seed: follow edges in the appropriate direction
  const seedEdges =
    direction === 'dependents'
      ? graph.getInEdges(nodeId, edgeTypes)
      : graph.getOutEdges(nodeId, edgeTypes);

  for (const edge of seedEdges) {
    const neighborId = direction === 'dependents' ? edge.source : edge.target;
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queueIds.push(neighborId);
      queueDepths.push(1);
      queueParents.push(0); // parent is the source node at index 0
      queueEdgeTypes.push(edge.type);
    }
  }

  let head = 1; // start after sentinel

  while (head < queueIds.length) {
    const currentId = queueIds[head]!;
    const currentDepth = queueDepths[head]!;

    const node = graph.getNode(currentId);
    if (!node) {
      head++;
      continue;
    }

    if (currentDepth < maxDepth) {
      const nextEdges =
        direction === 'dependents'
          ? graph.getInEdges(currentId, edgeTypes)
          : graph.getOutEdges(currentId, edgeTypes);

      for (const edge of nextEdges) {
        const neighborId = direction === 'dependents' ? edge.source : edge.target;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queueIds.push(neighborId);
          queueDepths.push(currentDepth + 1);
          queueParents.push(head);
          queueEdgeTypes.push(edge.type);
        }
      }
    }

    head++;
  }

  // Build results: reconstruct paths from parent pointers.
  // BFS guarantees items are already ordered by distance, so no sort needed.
  const impacted: ImpactedNode[] = [];
  const fileSet = new Set<string>();
  let maxImpactDepth = 0;

  for (let i = 1; i < queueIds.length; i++) {
    const node = graph.getNode(queueIds[i]!);
    if (!node) continue;

    const depth = queueDepths[i]!;

    // Reconstruct path by walking parent pointers
    const path: string[] = [];
    let idx = i;
    while (idx !== -1) {
      path.push(queueIds[idx]!);
      idx = queueParents[idx]!;
    }
    path.reverse();

    // Collect edge types along the path
    const edgeTypesUsed: EdgeType[] = [];
    idx = i;
    while (queueParents[idx]! !== -1) {
      edgeTypesUsed.push(queueEdgeTypes[idx]!);
      idx = queueParents[idx]!;
    }
    edgeTypesUsed.reverse();

    impacted.push({ node, distance: depth, path, edgeTypes: edgeTypesUsed });

    if (node.location) fileSet.add(node.location.file);
    if (depth > maxImpactDepth) maxImpactDepth = depth;
  }

  return {
    source: sourceNode,
    impacted,
    stats: {
      totalImpacted: impacted.length,
      fileCount: fileSet.size,
      maxDepth: maxImpactDepth,
    },
  };
}

/**
 * Get a human-readable impact summary suitable for AI consumption.
 */
export function formatImpactSummary(result: ImpactResult): string {
  const lines: string[] = [];
  lines.push(`Impact analysis for: ${result.source.name} (${result.source.type})`);
  lines.push(
    `Total impacted: ${result.stats.totalImpacted} nodes across ${result.stats.fileCount} files`,
  );
  lines.push('');

  // Group by file
  const byFile = new Map<string, ImpactedNode[]>();
  for (const item of result.impacted) {
    const file = item.node.location?.file ?? '(unknown)';
    let list = byFile.get(file);
    if (!list) {
      list = [];
      byFile.set(file, list);
    }
    list.push(item);
  }

  for (const [file, items] of byFile) {
    lines.push(`  ${file}:`);
    for (const item of items) {
      const indent = '    ';
      lines.push(
        `${indent}${item.node.name} (${item.node.type}) - distance: ${item.distance}, via: ${item.edgeTypes.join(' → ')}`,
      );
    }
  }

  return lines.join('\n');
}
