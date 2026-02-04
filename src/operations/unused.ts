import type { CodeGraph } from '../core/graph.js';
import type { CodeNode, NodeType } from '../core/types.js';

export interface UnusedSymbol {
  node: CodeNode;
  reason: 'no-callers' | 'no-importers' | 'no-references';
  confidence: 'high' | 'medium';
}

export interface FindUnusedOptions {
  /** Scope analysis to a specific directory. */
  path?: string;
  /** Filter by node type. */
  type?: NodeType;
  /** Exclude files matching these patterns (entry points, configs, etc.). */
  excludePatterns?: string[];
}

/** Default file patterns to exclude from dead code detection (entry points). */
const DEFAULT_EXCLUDE_PATTERNS = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'main.ts',
  'main.js',
  'cli.ts',
  'cli.js',
  'server.ts',
  'server.js',
  'app.ts',
  'app.js',
  'setup.ts',
  'setup.js',
];

/**
 * Find unused symbols in the code graph.
 *
 * Detection rules:
 * 1. Functions with zero inbound `calls` edges and not exported → high confidence
 * 2. Exported functions with zero inbound `imports` + `references` edges → medium confidence
 * 3. Variables/types with zero inbound `references` + `imports` edges → medium confidence
 *
 * Excludes:
 * - File nodes, doc nodes, snippet nodes
 * - Symbols in entry point files (index.ts, main.ts, cli.ts, etc.)
 * - Class constructors
 */
export function findUnused(graph: CodeGraph, options: FindUnusedOptions = {}): UnusedSymbol[] {
  const excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDE_PATTERNS;
  const results: UnusedSymbol[] = [];

  // Pre-compute the set of entry point file paths for O(1) lookup
  const entryPointFiles = new Set<string>();
  for (const node of graph.allNodes()) {
    if (!node.location) continue;
    const file = node.location.file;
    if (entryPointFiles.has(file)) continue;
    for (const pattern of excludePatterns) {
      if (file.endsWith('/' + pattern) || file === pattern) {
        entryPointFiles.add(file);
        break;
      }
    }
  }

  const isEntryPointFile = (filePath: string): boolean => entryPointFiles.has(filePath);

  const isExported = (node: CodeNode): boolean => {
    const inEdges = graph.getInEdges(node.id, ['exports']);
    return inEdges.length > 0;
  };

  for (const node of graph.allNodes()) {
    // Skip non-symbol types
    if (
      node.type === 'file' ||
      node.type === 'doc' ||
      node.type === 'snippet' ||
      node.type === 'module' ||
      node.type === 'export'
    ) {
      continue;
    }

    // Filter by type if specified
    if (options.type && node.type !== options.type) continue;

    // Filter by path if specified
    if (options.path && node.location) {
      if (!node.location.file.startsWith(options.path)) continue;
    }

    // Skip entry point files
    if (node.location && isEntryPointFile(node.location.file)) continue;

    // Skip constructors
    if (node.name === 'constructor') continue;

    // Check for usage
    if (node.type === 'function') {
      const callers = graph.getInEdges(node.id, ['calls']);
      const importers = graph.getInEdges(node.id, ['imports']);
      const references = graph.getInEdges(node.id, ['references']);

      if (callers.length === 0 && importers.length === 0 && references.length === 0) {
        if (isExported(node)) {
          results.push({ node, reason: 'no-importers', confidence: 'medium' });
        } else {
          results.push({ node, reason: 'no-callers', confidence: 'high' });
        }
      }
    } else if (node.type === 'variable' || node.type === 'type' || node.type === 'class') {
      const importers = graph.getInEdges(node.id, ['imports']);
      const references = graph.getInEdges(node.id, ['references']);
      const callers = graph.getInEdges(node.id, ['calls']);

      if (importers.length === 0 && references.length === 0 && callers.length === 0) {
        if (isExported(node)) {
          results.push({ node, reason: 'no-importers', confidence: 'medium' });
        } else {
          results.push({ node, reason: 'no-references', confidence: 'high' });
        }
      }
    }
  }

  // Sort: high confidence first, then by file path
  results.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    const fileA = a.node.location?.file ?? '';
    const fileB = b.node.location?.file ?? '';
    return fileA.localeCompare(fileB);
  });

  return results;
}

/**
 * Format unused symbols as a human-readable summary.
 */
export function formatUnusedSummary(results: UnusedSymbol[]): string {
  if (results.length === 0) return 'No unused symbols found.';

  const lines: string[] = [];
  lines.push(
    `Found ${results.length} potentially unused symbol${results.length === 1 ? '' : 's'}:`,
  );
  lines.push('');

  // Group by file
  const byFile = new Map<string, UnusedSymbol[]>();
  for (const r of results) {
    const file = r.node.location?.file ?? '(unknown)';
    let list = byFile.get(file);
    if (!list) {
      list = [];
      byFile.set(file, list);
    }
    list.push(r);
  }

  for (const [file, symbols] of byFile) {
    lines.push(`  ${file}:`);
    for (const s of symbols) {
      const line = s.node.location?.startLine ?? '?';
      const conf = s.confidence === 'high' ? '' : ' (low confidence)';
      lines.push(`    ${s.node.name} [${s.node.type}] :${line} — ${s.reason}${conf}`);
    }
  }

  return lines.join('\n');
}
