import type { CodeEdge, CreateEdgeInput } from './types.js';

let edgeCounter = 0;

/**
 * V8-optimized: deterministic edge IDs avoid expensive Date.now() calls.
 * Counter suffix ensures uniqueness for parallel edges between same nodes.
 */
function generateEdgeId(input: CreateEdgeInput): string {
  if (input.id) return input.id;
  return `${input.source}-${input.type}-${input.target}-${++edgeCounter}`;
}

/**
 * Create a CodeEdge with consistent property order for V8 hidden class stability.
 */
export function createEdge(input: CreateEdgeInput): CodeEdge {
  const edge: CodeEdge = {
    id: generateEdgeId(input),
    source: input.source,
    target: input.target,
    type: input.type,
    weight: input.weight ?? 1.0,
    metadata: input.metadata ?? {},
  };
  return edge;
}

/**
 * Reset the internal edge counter. Used for testing.
 */
export function resetEdgeCounter(): void {
  edgeCounter = 0;
}
