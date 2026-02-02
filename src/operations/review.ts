import type { CodeGraph } from '../core/graph.js';
import { analyzeImpact } from './impact.js';
import { buildContext } from '../ai/context-builder.js';

export interface ReviewResult {
  /** Summary of changes detected. */
  changes: ChangeInfo[];
  /** Aggregated impact across all changes. */
  impact: ImpactSummary;
  /** Token-budgeted context focused on the change blast radius. */
  context: string;
  /** Estimated tokens used. */
  estimatedTokens: number;
}

export interface ChangeInfo {
  file: string;
  symbols: Array<{
    name: string;
    type: string;
    line: number | null;
    signature: string;
  }>;
}

export interface ImpactSummary {
  totalImpacted: number;
  fileCount: number;
  maxDepth: number;
  impactedSymbols: Array<{
    name: string;
    type: string;
    file: string | null;
    distance: number;
    via: string;
  }>;
}

/**
 * Analyze changes in specified files and build a review-optimized context.
 *
 * For each file:
 * 1. Finds all symbols currently in the graph for that file
 * 2. Runs impact analysis on each symbol to find downstream effects
 * 3. Builds a token-budgeted context covering the change blast radius
 */
export function reviewChanges(
  graph: CodeGraph,
  files: string[],
  maxTokens: number = 8000,
): ReviewResult {
  const changes: ChangeInfo[] = [];
  const seedIds: string[] = [];
  const allImpacted = new Map<
    string,
    { name: string; type: string; file: string | null; distance: number; via: string }
  >();

  for (const file of files) {
    const fileNodes = graph.findByFile(file);
    if (fileNodes.length === 0) continue;

    const symbols: ChangeInfo['symbols'] = [];

    for (const node of fileNodes) {
      if (node.type === 'file') continue;

      symbols.push({
        name: node.name,
        type: node.type,
        line: node.location?.startLine ?? null,
        signature: node.signature || '',
      });

      seedIds.push(node.id);

      // Run impact analysis for each non-file symbol
      try {
        const impact = analyzeImpact(graph, node.id, { maxDepth: 3, direction: 'dependents' });
        for (const item of impact.impacted) {
          const existing = allImpacted.get(item.node.id);
          if (!existing || item.distance < existing.distance) {
            allImpacted.set(item.node.id, {
              name: item.node.name,
              type: item.node.type,
              file: item.node.location?.file ?? null,
              distance: item.distance,
              via: item.edgeTypes.join(' \u2192 '),
            });
          }
        }
      } catch {
        // Skip symbols that can't be analyzed
      }
    }

    if (symbols.length > 0) {
      changes.push({ file, symbols });
    }
  }

  // Deduplicate seed IDs (a symbol might appear in impact of another)
  const uniqueSeeds = [...new Set(seedIds)];

  // Build context covering the blast radius
  const contextResult = buildContext(graph, uniqueSeeds.slice(0, 20), { maxTokens, depth: 2 });

  // Compute impact summary
  const impactedSymbols = [...allImpacted.values()];
  impactedSymbols.sort((a, b) => a.distance - b.distance);

  const impactFiles = new Set(impactedSymbols.map((s) => s.file).filter(Boolean));
  const maxDepth = impactedSymbols.reduce((max, s) => Math.max(max, s.distance), 0);

  return {
    changes,
    impact: {
      totalImpacted: impactedSymbols.length,
      fileCount: impactFiles.size,
      maxDepth,
      impactedSymbols: impactedSymbols.slice(0, 50), // cap at 50 for readability
    },
    context: contextResult.context,
    estimatedTokens: contextResult.estimatedTokens,
  };
}

/**
 * Format review results as structured text for AI consumption.
 */
export function formatReviewSummary(result: ReviewResult): string {
  const lines: string[] = [];

  // Changes section
  lines.push('## Changes');
  for (const change of result.changes) {
    lines.push(`\n### ${change.file}`);
    for (const sym of change.symbols) {
      const sig = sym.signature ? ` — ${sym.signature}` : '';
      lines.push(`  ${sym.type} ${sym.name}${sym.line ? `:${sym.line}` : ''}${sig}`);
    }
  }

  // Impact section
  if (result.impact.totalImpacted > 0) {
    lines.push('\n## Impact');
    lines.push(
      `${result.impact.totalImpacted} symbols affected across ${result.impact.fileCount} files (max depth: ${result.impact.maxDepth})`,
    );
    lines.push('');

    // Group by file
    const byFile = new Map<string, typeof result.impact.impactedSymbols>();
    for (const sym of result.impact.impactedSymbols) {
      const file = sym.file ?? '(unknown)';
      let list = byFile.get(file);
      if (!list) {
        list = [];
        byFile.set(file, list);
      }
      list.push(sym);
    }

    for (const [file, syms] of byFile) {
      lines.push(`  ${file}:`);
      for (const sym of syms) {
        lines.push(`    ${sym.name} [${sym.type}] — distance: ${sym.distance}, via: ${sym.via}`);
      }
    }
  } else {
    lines.push('\n## Impact');
    lines.push('No downstream impact detected.');
  }

  // Context section
  lines.push('\n## Code Context');
  lines.push(`(~${result.estimatedTokens} tokens)`);
  lines.push('');
  lines.push(result.context);

  return lines.join('\n');
}
