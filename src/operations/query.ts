import type { CodeGraph } from '../core/graph.js';
import type { CodeNode, EdgeType, NodeType } from '../core/types.js';

/**
 * Chainable query builder for the code graph.
 *
 * Usage:
 *   query(graph)
 *     .ofType('function')
 *     .inFile('src/auth/handler.ts')
 *     .withName(/^handle/)
 *     .results()
 */
export class GraphQuery {
  private graph: CodeGraph;
  private filters: Array<(node: CodeNode) => boolean> = [];

  constructor(graph: CodeGraph) {
    this.graph = graph;
  }

  /** Filter by node type(s). */
  ofType(...types: NodeType[]): this {
    const typeSet = new Set(types);
    this.filters.push((node) => typeSet.has(node.type));
    return this;
  }

  /** Filter by file path (exact match or regex). */
  inFile(file: string | RegExp): this {
    if (typeof file === 'string') {
      this.filters.push((node) => node.location?.file === file);
    } else {
      this.filters.push((node) => node.location !== null && file.test(node.location.file));
    }
    return this;
  }

  /** Filter by name (exact case-insensitive or regex). */
  withName(name: string | RegExp): this {
    if (typeof name === 'string') {
      // Pre-compute lowercased name once; avoids per-node toLowerCase() allocation
      const lower = name.toLowerCase();
      this.filters.push((node) => {
        const nl = node.name.length;
        if (nl !== lower.length) return false; // fast length check
        return node.name.toLowerCase() === lower;
      });
    } else {
      this.filters.push((node) => name.test(node.name));
    }
    return this;
  }

  /** Filter by content (regex search). */
  withContent(pattern: RegExp): this {
    this.filters.push((node) => pattern.test(node.content));
    return this;
  }

  /** Filter: only nodes that have embeddings. */
  withEmbedding(): this {
    this.filters.push((node) => node.embedding !== null);
    return this;
  }

  /** Filter by metadata key existence or value. */
  withMetadata(key: string, value?: unknown): this {
    if (value === undefined) {
      this.filters.push((node) => key in node.metadata);
    } else {
      this.filters.push((node) => node.metadata[key] === value);
    }
    return this;
  }

  /** Filter: nodes that have at least one outbound edge of the given type(s). */
  withOutEdge(...edgeTypes: EdgeType[]): this {
    this.filters.push((node) => {
      const edges = this.graph.getOutEdges(node.id, edgeTypes);
      return edges.length > 0;
    });
    return this;
  }

  /** Filter: nodes that have at least one inbound edge of the given type(s). */
  withInEdge(...edgeTypes: EdgeType[]): this {
    this.filters.push((node) => {
      const edges = this.graph.getInEdges(node.id, edgeTypes);
      return edges.length > 0;
    });
    return this;
  }

  /** Custom predicate filter. */
  where(predicate: (node: CodeNode) => boolean): this {
    this.filters.push(predicate);
    return this;
  }

  /** Test a node against all accumulated filters. Indexed for-loop is monomorphic in V8. */
  private _matches(node: CodeNode): boolean {
    const filters = this.filters;
    for (let i = 0; i < filters.length; i++) {
      if (!filters[i]!(node)) return false;
    }
    return true;
  }

  /** Execute the query and return matching nodes. */
  results(): CodeNode[] {
    const result: CodeNode[] = [];
    for (const node of this.graph.allNodes()) {
      if (this._matches(node)) result.push(node);
    }
    return result;
  }

  /** Execute and return count only (avoids allocating result array). */
  count(): number {
    let count = 0;
    for (const node of this.graph.allNodes()) {
      if (this._matches(node)) count++;
    }
    return count;
  }

  /** Execute and return first match only. */
  first(): CodeNode | undefined {
    for (const node of this.graph.allNodes()) {
      if (this._matches(node)) return node;
    }
    return undefined;
  }
}

/** Create a new query builder for the given graph. */
export function query(graph: CodeGraph): GraphQuery {
  return new GraphQuery(graph);
}

export interface SearchResult {
  node: CodeNode;
  score: number;
}

const TYPE_SCORES: Record<string, number> = {
  class: 10,
  function: 9,
  type: 8,
  export: 7,
  variable: 5,
  file: 3,
  doc: 2,
};

export function search(
  graph: CodeGraph,
  term: string,
  options?: { type?: NodeType; file?: string | RegExp },
): SearchResult[] {
  const pattern = new RegExp(escapeForRegex(term), 'i');
  const termLower = term.toLowerCase();
  const results: SearchResult[] = [];

  let q = query(graph);
  if (options?.type) q = q.ofType(options.type);
  if (options?.file) q = q.inFile(options.file);

  for (const node of q.results()) {
    const nameMatch = pattern.test(node.name);
    const qualifiedMatch = !nameMatch && pattern.test(node.qualifiedName);
    const fileMatch =
      !nameMatch && !qualifiedMatch && node.location?.file
        ? pattern.test(node.location.file)
        : false;

    if (!nameMatch && !qualifiedMatch && !fileMatch) continue;

    let score = 0;

    if (nameMatch) {
      score += 30;
      const nameLower = node.name.toLowerCase();
      if (nameLower === termLower) score += 20;
      else if (nameLower.startsWith(termLower)) score += 10;
    } else if (qualifiedMatch) {
      score += 15;
    } else {
      score += 5;
    }

    score += TYPE_SCORES[node.type] ?? 1;
    if (graph.hasInEdgeOfType(node.id, 'exports')) score += 5;

    results.push({ node, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function escapeForRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
