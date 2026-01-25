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

  const impacted: ImpactedNode[] = [];
  const visited = new Set<string>();
  visited.add(nodeId);

  // BFS with path tracking
  const queue: Array<{
    id: string;
    depth: number;
    path: string[];
    edgeTypesUsed: EdgeType[];
  }> = [];

  // Seed: follow edges in the appropriate direction
  const seedEdges =
    direction === 'dependents'
      ? graph.getInEdges(nodeId, edgeTypes) // who points to me?
      : graph.getOutEdges(nodeId, edgeTypes); // what do I point to?

  for (const edge of seedEdges) {
    const neighborId = direction === 'dependents' ? edge.source : edge.target;
    if (!visited.has(neighborId)) {
      visited.add(neighborId);
      queue.push({
        id: neighborId,
        depth: 1,
        path: [nodeId, neighborId],
        edgeTypesUsed: [edge.type],
      });
    }
  }

  let head = 0;

  while (head < queue.length) {
    const current = queue[head++]!;
    const node = graph.getNode(current.id);
    if (!node) continue;

    impacted.push({
      node,
      distance: current.depth,
      path: current.path,
      edgeTypes: current.edgeTypesUsed,
    });

    if (current.depth >= maxDepth) continue;

    const nextEdges =
      direction === 'dependents'
        ? graph.getInEdges(current.id, edgeTypes)
        : graph.getOutEdges(current.id, edgeTypes);

    for (const edge of nextEdges) {
      const neighborId = direction === 'dependents' ? edge.source : edge.target;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({
          id: neighborId,
          depth: current.depth + 1,
          path: [...current.path, neighborId],
          edgeTypesUsed: [...current.edgeTypesUsed, edge.type],
        });
      }
    }
  }

  // Sort by distance (closest first)
  impacted.sort((a, b) => a.distance - b.distance);

  // Compute stats
  const fileSet = new Set<string>();
  let maxImpactDepth = 0;
  for (const item of impacted) {
    if (item.node.location) fileSet.add(item.node.location.file);
    if (item.distance > maxImpactDepth) maxImpactDepth = item.distance;
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
  lines.push(`Total impacted: ${result.stats.totalImpacted} nodes across ${result.stats.fileCount} files`);
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
