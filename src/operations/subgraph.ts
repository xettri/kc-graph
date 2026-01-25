import { CodeGraph } from '../core/graph.js';
import type { CodeNode, EdgeType, NodeType } from '../core/types.js';
import { bfs } from './traversal.js';

export interface SubgraphOptions {
  /** Maximum hops from seed nodes (default: 3). */
  maxDepth?: number;
  /** Only follow these edge types. */
  edgeTypes?: EdgeType[];
  /** Only include these node types. */
  nodeTypes?: NodeType[];
  /** Direction of traversal (default: 'both'). */
  direction?: 'outbound' | 'inbound' | 'both';
}

/**
 * Extract a subgraph around seed nodes.
 * Returns a new CodeGraph containing the relevant neighborhood.
 */
export function extractSubgraph(
  graph: CodeGraph,
  seedIds: string[],
  options: SubgraphOptions = {},
): CodeGraph {
  const maxDepth = options.maxDepth ?? 3;
  const edgeTypes = options.edgeTypes;
  const nodeTypes = options.nodeTypes ? new Set(options.nodeTypes) : null;
  const direction = options.direction ?? 'both';

  const subgraph = new CodeGraph();
  const includedNodeIds = new Set<string>();

  // BFS from each seed node to collect nodes
  for (const seedId of seedIds) {
    for (const { node } of bfs(graph, seedId, { maxDepth, edgeTypes, direction })) {
      if (nodeTypes && !nodeTypes.has(node.type)) continue;
      if (!includedNodeIds.has(node.id)) {
        includedNodeIds.add(node.id);
        subgraph.addNode({
          id: node.id,
          type: node.type,
          name: node.name,
          qualifiedName: node.qualifiedName,
          content: node.content,
          signature: node.signature,
          location: node.location,
          metadata: node.metadata,
          embedding: node.embedding,
        });
      }
    }
  }

  // Add edges between included nodes
  for (const nodeId of includedNodeIds) {
    const outEdges = graph.getOutEdges(nodeId, edgeTypes);
    for (const edge of outEdges) {
      if (includedNodeIds.has(edge.target)) {
        try {
          subgraph.addEdge({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: edge.type,
            weight: edge.weight,
            metadata: edge.metadata,
          });
        } catch {
          // Edge already exists (can happen with overlapping seed neighborhoods)
        }
      }
    }
  }

  return subgraph;
}

/**
 * Get the containment tree for a file (file → classes/functions → methods/variables).
 */
export function getFileStructure(
  graph: CodeGraph,
  filePath: string,
): Map<string, CodeNode[]> {
  const structure = new Map<string, CodeNode[]>();
  const fileNodes = graph.findByFile(filePath);

  for (const node of fileNodes) {
    const children = graph.getSuccessors(node.id, ['contains']);
    if (children.length > 0 || node.type === 'file') {
      structure.set(node.id, children);
    }
  }

  return structure;
}
