export interface ParseResult {
  /** Node inputs extracted from the source. */
  nodes: ParsedNodeInfo[];
  /** Edge inputs extracted from the source. */
  edges: ParsedEdgeInfo[];
}

export interface ParsedNodeInfo {
  type: 'file' | 'module' | 'class' | 'function' | 'variable' | 'type' | 'export';
  name: string;
  qualifiedName: string;
  content: string;
  signature: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  metadata: Record<string, unknown>;
}

export interface ParsedEdgeInfo {
  sourceQualifiedName: string;
  targetQualifiedName: string;
  type: 'contains' | 'calls' | 'imports' | 'extends' | 'implements' | 'references' | 'exports';
  metadata?: Record<string, unknown>;
}

export interface ParserOptions {
  /** Include function/method bodies in node content (default: true). */
  includeBody?: boolean;
  /** Include JSDoc/TSDoc comments in metadata (default: true). */
  includeJSDoc?: boolean;
  /** Max content length per node in characters (default: 5000). Truncates large functions. */
  maxContentLength?: number;
}
