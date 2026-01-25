import type { CodeGraph } from '../core/graph.js';
import type { ContextOptions, NodeType } from '../core/types.js';
import { getContextForSymbol, getContextForFile } from '../ai/context-builder.js';
import { analyzeImpact, formatImpactSummary } from '../operations/impact.js';
import { findSimilar } from '../ai/embeddings.js';
import { query } from '../operations/query.js';

// ---------------------------------------------------------------------------
// MCP Tool Schemas
// ---------------------------------------------------------------------------

/**
 * MCP tool definitions for AI agent integration.
 * These schemas describe the tools that AI agents can call.
 * All inputs use human-readable identifiers (file paths, symbol names).
 */
export const toolDefinitions = {
  search_code: {
    name: 'search_code',
    description: 'Search for code symbols (functions, classes, variables, types) in the knowledge graph',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Symbol name or pattern to search for' },
        type: {
          type: 'string',
          enum: ['function', 'class', 'variable', 'type', 'file', 'module'],
          description: 'Filter by symbol type',
        },
        file: { type: 'string', description: 'Filter by file path (exact or pattern)' },
      },
      required: ['query'],
    },
  },

  get_context: {
    name: 'get_context',
    description: 'Get token-optimized context for a code symbol or file, including related code and documentation',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol name to get context for' },
        file: { type: 'string', description: 'File path (narrows symbol lookup or gets file context)' },
        maxTokens: { type: 'number', description: 'Maximum token budget (default: 4000)', default: 4000 },
      },
      required: [],
    },
  },

  get_impact: {
    name: 'get_impact',
    description: 'Analyze the impact of changing a code symbol — what other code would be affected',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol name to analyze' },
        file: { type: 'string', description: 'File path to narrow symbol lookup' },
        maxDepth: { type: 'number', description: 'Maximum analysis depth (default: 5)', default: 5 },
      },
      required: ['symbol'],
    },
  },

  get_structure: {
    name: 'get_structure',
    description: 'Get the structure of a file or module — its classes, functions, variables, and exports',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path to get structure for' },
      },
      required: ['path'],
    },
  },

  find_similar: {
    name: 'find_similar',
    description: 'Find code symbols semantically similar to a given symbol (requires embeddings)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol name to find similar code for' },
        file: { type: 'string', description: 'File path to narrow symbol lookup' },
        limit: { type: 'number', description: 'Maximum results (default: 10)', default: 10 },
      },
      required: ['symbol'],
    },
  },
} as const;

// ---------------------------------------------------------------------------
// MCP Tool Handlers
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Create MCP tool handlers bound to a specific graph instance.
 * Returns a map of tool name → handler function.
 */
export function createToolHandlers(graph: CodeGraph): Record<string, (args: Record<string, unknown>) => ToolResult> {
  return {
    search_code: (args) => handleSearchCode(graph, args),
    get_context: (args) => handleGetContext(graph, args),
    get_impact: (args) => handleGetImpact(graph, args),
    get_structure: (args) => handleGetStructure(graph, args),
    find_similar: (args) => handleFindSimilar(graph, args),
  };
}

function handleSearchCode(graph: CodeGraph, args: Record<string, unknown>): ToolResult {
  const searchQuery = args['query'] as string;
  const typeFilter = args['type'] as NodeType | undefined;
  const fileFilter = args['file'] as string | undefined;

  let q = query(graph);

  if (typeFilter) {
    q = q.ofType(typeFilter);
  }
  if (fileFilter) {
    if (fileFilter.includes('*')) {
      q = q.inFile(new RegExp(fileFilter.replace(/\*/g, '.*')));
    } else {
      q = q.inFile(fileFilter);
    }
  }

  // Search by name (case-insensitive partial match)
  q = q.withName(new RegExp(escapeRegex(searchQuery), 'i'));

  const results = q.results();

  const formatted = results.map((node) => ({
    name: node.name,
    type: node.type,
    file: node.location?.file ?? null,
    line: node.location?.startLine ?? null,
    signature: node.signature || null,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
  };
}

function handleGetContext(graph: CodeGraph, args: Record<string, unknown>): ToolResult {
  const symbol = args['symbol'] as string | undefined;
  const file = args['file'] as string | undefined;
  const maxTokens = (args['maxTokens'] as number) || 4000;

  const options: ContextOptions & { file?: string } = { maxTokens, file };

  let result;
  if (symbol) {
    result = getContextForSymbol(graph, symbol, options);
  } else if (file) {
    result = getContextForFile(graph, file, { maxTokens });
  } else {
    return {
      content: [{ type: 'text', text: 'Error: provide either "symbol" or "file"' }],
      isError: true,
    };
  }

  if (!result) {
    return {
      content: [{ type: 'text', text: `Not found: ${symbol ?? file}` }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: result.context }],
  };
}

function handleGetImpact(graph: CodeGraph, args: Record<string, unknown>): ToolResult {
  const symbol = args['symbol'] as string;
  const file = args['file'] as string | undefined;
  const maxDepth = (args['maxDepth'] as number) || 5;

  const node = graph.resolve(symbol, file);
  if (!node) {
    return {
      content: [{ type: 'text', text: `Symbol not found: ${symbol}` }],
      isError: true,
    };
  }

  const result = analyzeImpact(graph, node.id, { maxDepth });
  const summary = formatImpactSummary(result);

  return {
    content: [{ type: 'text', text: summary }],
  };
}

function handleGetStructure(graph: CodeGraph, args: Record<string, unknown>): ToolResult {
  const path = args['path'] as string;
  const fileNodes = graph.findByFile(path);

  if (fileNodes.length === 0) {
    return {
      content: [{ type: 'text', text: `No indexed file found: ${path}` }],
      isError: true,
    };
  }

  const structure: Array<{
    name: string;
    type: string;
    line: number | null;
    signature: string | null;
    children: Array<{ name: string; type: string; signature: string | null }>;
  }> = [];

  for (const node of fileNodes) {
    if (node.type === 'file') continue;

    const children = graph
      .getSuccessors(node.id, ['contains'])
      .map((child) => ({
        name: child.name,
        type: child.type,
        signature: child.signature || null,
      }));

    structure.push({
      name: node.name,
      type: node.type,
      line: node.location?.startLine ?? null,
      signature: node.signature || null,
      children,
    });
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(structure, null, 2) }],
  };
}

function handleFindSimilar(graph: CodeGraph, args: Record<string, unknown>): ToolResult {
  const symbol = args['symbol'] as string;
  const file = args['file'] as string | undefined;
  const limit = (args['limit'] as number) || 10;

  const node = graph.resolve(symbol, file);
  if (!node) {
    return {
      content: [{ type: 'text', text: `Symbol not found: ${symbol}` }],
      isError: true,
    };
  }

  if (!node.embedding) {
    return {
      content: [{ type: 'text', text: `No embedding available for: ${symbol}` }],
      isError: true,
    };
  }

  const results = findSimilar(graph, node.embedding, limit);

  const formatted = results
    .filter((r) => r.node.id !== node.id)
    .map((r) => ({
      name: r.node.name,
      type: r.node.type,
      file: r.node.location?.file ?? null,
      score: Math.round(r.score * 1000) / 1000,
    }));

  return {
    content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
