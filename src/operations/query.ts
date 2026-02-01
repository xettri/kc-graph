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
