import type { CodeGraph } from '../core/graph.js';
import type { ContextOptions, NodeType } from '../core/types.js';
import { getContextForSymbol, getContextForFile } from '../ai/context-builder.js';
import { analyzeImpact, formatImpactSummary } from '../operations/impact.js';
import { findSimilar } from '../ai/embeddings.js';
import { query } from '../operations/query.js';

export interface ProjectEntry {
  graph: CodeGraph;
  path: string;
}

export type ProjectMap = Map<string, ProjectEntry>;

export function singleProject(name: string, graph: CodeGraph, path: string): ProjectMap {
  return new Map([[name, { graph, path }]]);
}

const projectParam = {
  type: 'string',
  description: 'Project name to search in (omit to search all projects)',
};

export const toolDefinitions = {
  list_projects: {
    name: 'list_projects',
    description: 'List all indexed projects with their stats',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  search_code: {
    name: 'search_code',
    description: 'Search for code symbols (functions, classes, variables, types) across all indexed projects',
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
        project: projectParam,
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
        project: projectParam,
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
        project: projectParam,
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
        project: projectParam,
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
        project: projectParam,
      },
      required: ['symbol'],
    },
  },
} as const;

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function createToolHandlers(projects: ProjectMap): Record<string, (args: Record<string, unknown>) => ToolResult> {
  return {
    list_projects: () => handleListProjects(projects),
    search_code: (args) => handleSearchCode(projects, args),
    get_context: (args) => handleGetContext(projects, args),
    get_impact: (args) => handleGetImpact(projects, args),
    get_structure: (args) => handleGetStructure(projects, args),
    find_similar: (args) => handleFindSimilar(projects, args),
  };
}

function resolveProjects(projects: ProjectMap, filter?: string): [string, ProjectEntry][] {
  if (filter) {
    const entry = projects.get(filter);
    if (!entry) return [];
    return [[filter, entry]];
  }
  return [...projects.entries()];
}

function projectPrefix(name: string, multiProject: boolean): string {
  return multiProject ? `[${name}] ` : '';
}

function handleListProjects(projects: ProjectMap): ToolResult {
  const list = [...projects.entries()].map(([name, entry]) => ({
    name,
    path: entry.path,
    nodes: entry.graph.nodeCount,
    edges: entry.graph.edgeCount,
    files: new Set([...entry.graph.allNodes()].map(n => n.location?.file).filter(Boolean)).size,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
  };
}

function handleSearchCode(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const searchQuery = args['query'] as string;
  const typeFilter = args['type'] as NodeType | undefined;
  const fileFilter = args['file'] as string | undefined;
  const projectFilter = args['project'] as string | undefined;

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return { content: [{ type: 'text', text: `Project not found: ${projectFilter}` }], isError: true };
  }

  const multiProject = projects.size > 1 && !projectFilter;
  const allResults: Array<Record<string, unknown>> = [];

  for (const [name, entry] of targets) {
    let q = query(entry.graph);
    if (typeFilter) q = q.ofType(typeFilter);
    if (fileFilter) {
      if (fileFilter.includes('*')) {
        q = q.inFile(new RegExp(fileFilter.replace(/\*/g, '.*')));
      } else {
        q = q.inFile(fileFilter);
      }
    }
    q = q.withName(new RegExp(escapeRegex(searchQuery), 'i'));

    for (const node of q.results()) {
      allResults.push({
        ...(multiProject ? { project: name } : {}),
        name: node.name,
        type: node.type,
        file: node.location?.file ?? null,
        line: node.location?.startLine ?? null,
        signature: node.signature || null,
      });
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(allResults, null, 2) }],
  };
}

function handleGetContext(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const symbol = args['symbol'] as string | undefined;
  const file = args['file'] as string | undefined;
  const maxTokens = (args['maxTokens'] as number) || 4000;
  const projectFilter = args['project'] as string | undefined;

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return { content: [{ type: 'text', text: `Project not found: ${projectFilter}` }], isError: true };
  }

  const options: ContextOptions & { file?: string } = { maxTokens, file };
  const multiProject = projects.size > 1 && !projectFilter;

  for (const [name, entry] of targets) {
    let result;
    if (symbol) {
      result = getContextForSymbol(entry.graph, symbol, options);
    } else if (file) {
      result = getContextForFile(entry.graph, file, { maxTokens });
    } else {
      return {
        content: [{ type: 'text', text: 'Error: provide either "symbol" or "file"' }],
        isError: true,
      };
    }

    if (result) {
      const prefix = projectPrefix(name, multiProject);
      return {
        content: [{ type: 'text', text: prefix + result.context }],
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Not found: ${symbol ?? file}` }],
    isError: true,
  };
}

function handleGetImpact(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const symbol = args['symbol'] as string;
  const file = args['file'] as string | undefined;
  const maxDepth = (args['maxDepth'] as number) || 5;
  const projectFilter = args['project'] as string | undefined;

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return { content: [{ type: 'text', text: `Project not found: ${projectFilter}` }], isError: true };
  }

  const multiProject = projects.size > 1 && !projectFilter;

  for (const [name, entry] of targets) {
    const node = entry.graph.resolve(symbol, file);
    if (!node) continue;

    const result = analyzeImpact(entry.graph, node.id, { maxDepth });
    const summary = formatImpactSummary(result);
    const prefix = projectPrefix(name, multiProject);

    return {
      content: [{ type: 'text', text: prefix + summary }],
    };
  }

  return {
    content: [{ type: 'text', text: `Symbol not found: ${symbol}` }],
    isError: true,
  };
}

function handleGetStructure(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const path = args['path'] as string;
  const projectFilter = args['project'] as string | undefined;

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return { content: [{ type: 'text', text: `Project not found: ${projectFilter}` }], isError: true };
  }

  const multiProject = projects.size > 1 && !projectFilter;

  for (const [name, entry] of targets) {
    const fileNodes = entry.graph.findByFile(path);
    if (fileNodes.length === 0) continue;

    const structure: Array<Record<string, unknown>> = [];
    for (const node of fileNodes) {
      if (node.type === 'file') continue;
      const children = entry.graph
        .getSuccessors(node.id, ['contains'])
        .map((child) => ({
          name: child.name,
          type: child.type,
          signature: child.signature || null,
        }));
      structure.push({
        ...(multiProject ? { project: name } : {}),
        name: node.name,
        type: node.type,
        line: node.location?.startLine ?? null,
        signature: node.signature || null,
        children,
      });
    }

    if (structure.length > 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify(structure, null, 2) }],
      };
    }
  }

  return {
    content: [{ type: 'text', text: `No indexed file found: ${path}` }],
    isError: true,
  };
}

function handleFindSimilar(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const symbol = args['symbol'] as string;
  const file = args['file'] as string | undefined;
  const limit = (args['limit'] as number) || 10;
  const projectFilter = args['project'] as string | undefined;

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return { content: [{ type: 'text', text: `Project not found: ${projectFilter}` }], isError: true };
  }

  const multiProject = projects.size > 1 && !projectFilter;

  for (const [name, entry] of targets) {
    const node = entry.graph.resolve(symbol, file);
    if (!node) continue;

    if (!node.embedding) {
      return {
        content: [{ type: 'text', text: `No embedding available for: ${symbol}` }],
        isError: true,
      };
    }

    const results = findSimilar(entry.graph, node.embedding, limit);
    const formatted = results
      .filter((r) => r.node.id !== node.id)
      .map((r) => ({
        ...(multiProject ? { project: name } : {}),
        name: r.node.name,
        type: r.node.type,
        file: r.node.location?.file ?? null,
        score: Math.round(r.score * 1000) / 1000,
      }));

    return {
      content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }],
    };
  }

  return {
    content: [{ type: 'text', text: `Symbol not found: ${symbol}` }],
    isError: true,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
