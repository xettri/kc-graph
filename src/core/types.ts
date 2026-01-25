/**
 * Core type definitions for kc-graph.
 *
 * All node and edge types use flat interfaces with string-literal discriminators
 * to maintain monomorphic V8 hidden classes. This avoids polymorphic deopt and
 * keeps inline caching efficient across the entire graph.
 */

// ---------------------------------------------------------------------------
// Node Types
// ---------------------------------------------------------------------------

export const NODE_TYPES = [
  'file',
  'module',
  'class',
  'function',
  'variable',
  'type',
  'export',
  'doc',
  'snippet',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Location within a source file. */
export interface SourceLocation {
  file: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

/**
 * A node in the code knowledge graph.
 *
 * V8 optimization: single interface shape — every node object is initialized
 * with the same property order so V8 assigns one hidden class. The `type`
 * field discriminates semantics without class hierarchy polymorphism.
 */
export interface CodeNode {
  /** Unique identifier (deterministic: `${filePath}#${symbolName}` or uuid). */
  id: string;
  /** Discriminator for the kind of code entity. */
  type: NodeType;
  /** Human-readable name (function name, class name, file basename, etc.). */
  name: string;
  /** Full qualified name (e.g. `src/auth/handler.ts#login`). */
  qualifiedName: string;
  /** The actual source content or documentation text. */
  content: string;
  /** Signature for functions/methods/types (e.g. `(user: User) => Promise<Token>`). */
  signature: string;
  /** Source location (null for virtual nodes like aggregated docs). */
  location: SourceLocation | null;
  /** Arbitrary key-value metadata (JSDoc tags, language, framework hints). */
  metadata: Record<string, unknown>;
  /** Optional embedding vector for semantic search. Float32Array for SIMD. */
  embedding: Float32Array | null;
  /** Creation timestamp (epoch ms — number avoids Date boxing). */
  createdAt: number;
  /** Last update timestamp. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Edge Types
// ---------------------------------------------------------------------------

export const EDGE_TYPES = [
  'contains',
  'calls',
  'imports',
  'extends',
  'implements',
  'references',
  'exports',
  'depends_on',
  'documents',
  'tagged_with',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * A directed edge between two nodes.
 *
 * V8 optimization: same hidden-class strategy as CodeNode.
 */
export interface CodeEdge {
  /** Unique edge identifier. */
  id: string;
  /** Source node ID (tail of the directed edge). */
  source: string;
  /** Target node ID (head of the directed edge). */
  target: string;
  /** Relationship type. */
  type: EdgeType;
  /** Weight for relevance scoring (default 1.0). Higher = stronger relationship. */
  weight: number;
  /** Arbitrary metadata (e.g. import specifier, call site line). */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Input types (for creating nodes/edges without boilerplate)
// ---------------------------------------------------------------------------

export interface CreateNodeInput {
  id?: string;
  type: NodeType;
  name: string;
  qualifiedName?: string;
  content?: string;
  signature?: string;
  location?: SourceLocation | null;
  metadata?: Record<string, unknown>;
  embedding?: Float32Array | null;
}

export interface CreateEdgeInput {
  id?: string;
  source: string;
  target: string;
  type: EdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Query & Result types
// ---------------------------------------------------------------------------

export interface NodeFilter {
  type?: NodeType | NodeType[];
  name?: string | RegExp;
  file?: string | RegExp;
  hasEmbedding?: boolean;
}

export interface TraversalOptions {
  maxDepth?: number;
  edgeTypes?: EdgeType[];
  direction?: 'outbound' | 'inbound' | 'both';
}

export interface ImpactResult {
  /** The node that was changed. */
  source: CodeNode;
  /** Impacted nodes grouped by file, sorted by distance. */
  impacted: ImpactedNode[];
  /** Summary statistics. */
  stats: {
    totalImpacted: number;
    fileCount: number;
    maxDepth: number;
  };
}

export interface ImpactedNode {
  node: CodeNode;
  distance: number;
  path: string[];
  edgeTypes: EdgeType[];
}

export interface ContextOptions {
  maxTokens: number;
  includeSignatures?: boolean;
  includeDoc?: boolean;
  depth?: number;
}

export interface ContextResult {
  /** Nodes included in the context, ordered by relevance. */
  nodes: CodeNode[];
  /** Formatted context string ready for AI consumption. */
  context: string;
  /** Estimated token count. */
  estimatedTokens: number;
  /** Files touched by the context. */
  files: string[];
}

export interface SimilarityResult {
  node: CodeNode;
  score: number;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface GraphSnapshot {
  version: string;
  nodes: SerializedNode[];
  edges: CodeEdge[];
  metadata: {
    createdAt: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface SerializedNode extends Omit<CodeNode, 'embedding'> {
  /** Base64-encoded Float32Array, or null. */
  embedding: string | null;
}
