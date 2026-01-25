import type { CodeNode, CreateNodeInput } from './types.js';

let nodeCounter = 0;

/**
 * Generate a deterministic node ID from file path and symbol name,
 * or a unique ID if no qualified name is available.
 */
function generateNodeId(input: CreateNodeInput): string {
  if (input.id) return input.id;
  if (input.qualifiedName) return input.qualifiedName;
  return `node_${++nodeCounter}_${Date.now().toString(36)}`;
}

/**
 * Create a CodeNode with all fields initialized in consistent property order.
 *
 * V8 hidden class optimization: every node is created with the exact same
 * property insertion order, so V8 assigns a single hidden class to all
 * CodeNode objects. This keeps property lookups monomorphic.
 */
export function createNode(input: CreateNodeInput): CodeNode {
  const now = Date.now();
  const node: CodeNode = {
    id: generateNodeId(input),
    type: input.type,
    name: input.name,
    qualifiedName: input.qualifiedName ?? input.name,
    content: input.content ?? '',
    signature: input.signature ?? '',
    location: input.location ?? null,
    metadata: input.metadata ?? {},
    embedding: input.embedding ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return node;
}

/**
 * Estimate the token count of a node's content.
 * Uses content.length / 4 as a good approximation for code.
 */
export function estimateNodeTokens(node: CodeNode): number {
  let tokens = node.content.length >> 2; // fast divide by 4
  if (node.signature) {
    tokens += node.signature.length >> 2;
  }
  return Math.max(tokens, 1);
}

/**
 * Reset the internal node counter. Used for testing.
 */
export function resetNodeCounter(): void {
  nodeCounter = 0;
}
