import type { CodeGraph } from '../core/graph.js';
import type { ContextOptions, NodeType } from '../core/types.js';
import { getContextForSymbol, getContextForFile } from '../ai/context-builder.js';
import { analyzeImpact, formatImpactSummary } from '../operations/impact.js';
import { findSimilar } from '../ai/embeddings.js';
import { query } from '../operations/query.js';
import { findUnused, formatUnusedSummary } from '../operations/unused.js';
import { reviewChanges, formatReviewSummary } from '../operations/review.js';

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
    description:
      'Search for code symbols (functions, classes, variables, types) across all indexed projects',
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
    description:
      'Get token-optimized context for a code symbol or file, including related code and documentation',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol name to get context for' },
        file: {
          type: 'string',
          description: 'File path (narrows symbol lookup or gets file context)',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum token budget (default: 4000)',
          default: 4000,
        },
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
        maxDepth: {
          type: 'number',
          description: 'Maximum analysis depth (default: 5)',
          default: 5,
        },
        project: projectParam,
      },
      required: ['symbol'],
    },
  },

  get_structure: {
    name: 'get_structure',
    description:
      'Get the structure of a file or module — its classes, functions, variables, and exports',
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
  review_changes: {
    name: 'review_changes',
    description:
      'Analyze changed files — detect modified symbols, trace impact, and build review-focused context',
    inputSchema: {
      type: 'object' as const,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths that were changed',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum token budget for context (default: 8000)',
          default: 8000,
        },
        project: projectParam,
      },
      required: ['files'],
    },
  },

  find_unused: {
    name: 'find_unused',
    description:
      'Find potentially unused code — functions, variables, types with no callers or importers',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Scope analysis to a directory path' },
        type: {
          type: 'string',
          enum: ['function', 'class', 'variable', 'type'],
          description: 'Filter by symbol type',
        },
        project: projectParam,
      },
      required: [],
    },
  },
} as const;

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function createToolHandlers(
  projects: ProjectMap,
): Record<string, (args: Record<string, unknown>) => ToolResult> {
  return {
    list_projects: () => handleListProjects(projects),
    search_code: (args) => handleSearchCode(projects, args),
    get_context: (args) => handleGetContext(projects, args),
    get_impact: (args) => handleGetImpact(projects, args),
    get_structure: (args) => handleGetStructure(projects, args),
    find_similar: (args) => handleFindSimilar(projects, args),
    review_changes: (args) => handleReviewChanges(projects, args),
    find_unused: (args) => handleFindUnused(projects, args),
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
    files: new Set([...entry.graph.allNodes()].map((n) => n.location?.file).filter(Boolean)).size,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
  };
}

function handleSearchCode(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const searchQuery = requireString(args, 'query');
  if (typeof searchQuery !== 'string') return searchQuery;
  const typeFilter = optionalString(args, 'type') as NodeType | undefined;
  const fileFilter = optionalString(args, 'file');
  const projectFilter = optionalString(args, 'project');

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
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
  const symbol = optionalString(args, 'symbol');
  const file = optionalString(args, 'file');
  const maxTokens = optionalNumber(args, 'maxTokens', 4000);
  const projectFilter = optionalString(args, 'project');

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
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
  const symbol = requireString(args, 'symbol');
  if (typeof symbol !== 'string') return symbol;
  const file = optionalString(args, 'file');
  const maxDepth = optionalNumber(args, 'maxDepth', 5);
  const projectFilter = optionalString(args, 'project');

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
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
  const path = requireString(args, 'path');
  if (typeof path !== 'string') return path;
  const projectFilter = optionalString(args, 'project');

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
  }

  const multiProject = projects.size > 1 && !projectFilter;

  for (const [name, entry] of targets) {
    const fileNodes = entry.graph.findByFile(path);
    if (fileNodes.length === 0) continue;

    const structure: Array<Record<string, unknown>> = [];
    for (const node of fileNodes) {
      if (node.type === 'file') continue;
      const children = entry.graph.getSuccessors(node.id, ['contains']).map((child) => ({
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
  const symbol = requireString(args, 'symbol');
  if (typeof symbol !== 'string') return symbol;
  const file = optionalString(args, 'file');
  const limit = optionalNumber(args, 'limit', 10);
  const projectFilter = optionalString(args, 'project');

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
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

function handleReviewChanges(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const files = Array.isArray(args['files']) ? (args['files'] as string[]) : null;
  const maxTokens = optionalNumber(args, 'maxTokens', 8000);
  const projectFilter = optionalString(args, 'project');

  if (!files || files.length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: provide at least one file path in "files"' }],
      isError: true,
    };
  }

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
  }

  const multiProject = projects.size > 1 && !projectFilter;

  for (const [name, entry] of targets) {
    // Check if any of the files exist in this project's graph
    const hasFiles = files.some((f) => entry.graph.findByFile(f).length > 0);
    if (!hasFiles) continue;

    const result = reviewChanges(entry.graph, files, maxTokens);
    const summary = formatReviewSummary(result);
    const prefix = projectPrefix(name, multiProject);

    return {
      content: [{ type: 'text', text: prefix + summary }],
    };
  }

  return {
    content: [{ type: 'text', text: `No indexed files found matching: ${files.join(', ')}` }],
    isError: true,
  };
}

function handleFindUnused(projects: ProjectMap, args: Record<string, unknown>): ToolResult {
  const pathFilter = optionalString(args, 'path');
  const typeFilter = optionalString(args, 'type') as NodeType | undefined;
  const projectFilter = optionalString(args, 'project');

  const targets = resolveProjects(projects, projectFilter);
  if (targets.length === 0) {
    return {
      content: [{ type: 'text', text: `Project not found: ${projectFilter}` }],
      isError: true,
    };
  }

  const multiProject = projects.size > 1 && !projectFilter;
  const allSections: string[] = [];

  for (const [name, entry] of targets) {
    const results = findUnused(entry.graph, { path: pathFilter, type: typeFilter });
    if (results.length === 0) continue;

    const prefix = projectPrefix(name, multiProject);
    allSections.push(prefix + formatUnusedSummary(results));
  }

  if (allSections.length === 0) {
    return {
      content: [{ type: 'text', text: 'No unused symbols found.' }],
    };
  }

  return {
    content: [{ type: 'text', text: allSections.join('\n\n') }],
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireString(args: Record<string, unknown>, key: string): string | ToolResult {
  const val = args[key];
  if (typeof val !== 'string' || val.length === 0) {
    return {
      content: [
        { type: 'text', text: `Invalid or missing parameter: "${key}" must be a non-empty string` },
      ],
      isError: true,
    };
  }
  return val;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  return typeof val === 'string' ? val : String(val);
}

function optionalNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const val = args[key];
  if (val === undefined || val === null) return fallback;
  const num = typeof val === 'number' ? val : Number(val);
  return isFinite(num) ? num : fallback;
}
