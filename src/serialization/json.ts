import { CodeGraph } from '../core/graph.js';
import type { GraphSnapshot, SerializedNode } from '../core/types.js';

const SNAPSHOT_VERSION = '1.0';

/**
 * Export the graph to a JSON-serializable snapshot.
 * Float32Array embeddings are encoded as base64 strings.
 */
export function exportToJSON(graph: CodeGraph): GraphSnapshot {
  const nodes: SerializedNode[] = [];
  const edges = [...graph.allEdges()];

  for (const node of graph.allNodes()) {
    nodes.push({
      ...node,
      embedding: node.embedding ? float32ToBase64(node.embedding) : null,
    });
  }

  return {
    version: SNAPSHOT_VERSION,
    nodes,
    edges,
    metadata: {
      createdAt: Date.now(),
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
    },
  };
}

/**
 * Import a graph from a JSON snapshot.
 * Returns a new CodeGraph instance.
 */
export function importFromJSON(snapshot: GraphSnapshot): CodeGraph {
  if (!snapshot.version) {
    throw new Error('Invalid snapshot: missing version');
  }

  const graph = new CodeGraph();

  // Add nodes
  for (const serializedNode of snapshot.nodes) {
    graph.addNode({
      id: serializedNode.id,
      type: serializedNode.type,
      name: serializedNode.name,
      qualifiedName: serializedNode.qualifiedName,
      content: serializedNode.content,
      signature: serializedNode.signature,
      location: serializedNode.location,
      metadata: serializedNode.metadata,
      embedding:
        typeof serializedNode.embedding === 'string'
          ? base64ToFloat32(serializedNode.embedding)
          : null,
    });
  }

  // Add edges
  for (const edge of snapshot.edges) {
    try {
      graph.addEdge({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        weight: edge.weight,
        metadata: edge.metadata,
      });
    } catch {
      // Skip edges referencing missing nodes (defensive)
    }
  }

  return graph;
}

/**
 * Serialize graph to a JSON string.
 */
export function toJSONString(graph: CodeGraph, pretty: boolean = false): string {
  const snapshot = exportToJSON(graph);
  return pretty ? JSON.stringify(snapshot, null, 2) : JSON.stringify(snapshot);
}

/**
 * Deserialize graph from a JSON string.
 */
export function fromJSONString(json: string): CodeGraph {
  const snapshot: GraphSnapshot = JSON.parse(json);
  return importFromJSON(snapshot);
}

// ---------------------------------------------------------------------------
// Float32Array <-> Base64 encoding
// ---------------------------------------------------------------------------

function float32ToBase64(arr: Float32Array): string {
  const buffer = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  return buffer.toString('base64');
}

function base64ToFloat32(base64: string): Float32Array {
  const buffer = Buffer.from(base64, 'base64');
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
