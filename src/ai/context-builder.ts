import type { CodeGraph } from '../core/graph.js';
import type { CodeNode, ContextOptions, ContextResult } from '../core/types.js';
import { estimateNodeTokens } from '../core/node.js';
import { rankByRelevance } from './relevance.js';

/**
 * Build a token-budget-aware context from the graph.
 *
 * This is the primary AI integration point. Given seed nodes and a token budget,
 * it extracts the most relevant subgraph and formats it for AI consumption.
 *
 * Algorithm:
 * 1. Start from seed nodes (always included)
 * 2. Rank all reachable neighbors by relevance score
 * 3. Greedily add highest-scored nodes until token budget is exhausted
 * 4. Format the result as structured text
 */
export function buildContext(
  graph: CodeGraph,
  seedIds: string[],
  options: ContextOptions,
): ContextResult {
  const maxTokens = options.maxTokens;
  const includeSignatures = options.includeSignatures ?? true;
  const includeDoc = options.includeDoc ?? true;
  const depth = options.depth ?? 3;

  const includedNodes: CodeNode[] = [];
  let currentTokens = 0;
  const files = new Set<string>();

  // Phase 1: Include seed nodes (always included)
  for (const seedId of seedIds) {
    const node = graph.getNode(seedId);
    if (!node) continue;

    const tokens = estimateNodeTokens(node);
    if (currentTokens + tokens > maxTokens && includedNodes.length > 0) break;

    includedNodes.push(node);
    currentTokens += tokens;
    if (node.location) files.add(node.location.file);
  }

  // Phase 2: Rank neighbors by relevance and greedily add
  const ranked = rankByRelevance(graph, seedIds, depth);

  for (const { node } of ranked) {
    if (currentTokens >= maxTokens) break;

    // Skip doc nodes if not requested
    if (!includeDoc && node.type === 'doc') continue;

    // For non-seed nodes, we can include just the signature to save tokens
    let tokens: number;
    if (includeSignatures && node.signature) {
      tokens = Math.max((node.signature.length >> 2) + (node.name.length >> 2), 1);
    } else {
      tokens = estimateNodeTokens(node);
    }

    if (currentTokens + tokens > maxTokens) continue; // skip large nodes, try smaller ones

    includedNodes.push(node);
    currentTokens += tokens;
    if (node.location) files.add(node.location.file);
  }

  // Phase 3: Format output
  const context = formatContext(includedNodes, includeSignatures, seedIds);

  return {
    nodes: includedNodes,
    context,
    estimatedTokens: currentTokens,
    files: [...files],
  };
}

/**
 * Format nodes into a structured text context for AI consumption.
 */
function formatContext(
  nodes: CodeNode[],
  includeSignatures: boolean,
  seedIds: string[],
): string {
  const seedSet = new Set(seedIds);
  const sections: string[] = [];

  // Group by file for readability
  const byFile = new Map<string, CodeNode[]>();
  const noFile: CodeNode[] = [];

  for (const node of nodes) {
    if (node.location) {
      let list = byFile.get(node.location.file);
      if (!list) {
        list = [];
        byFile.set(node.location.file, list);
      }
      list.push(node);
    } else {
      noFile.push(node);
    }
  }

  for (const [file, fileNodes] of byFile) {
    sections.push(`--- ${file} ---`);

    for (const node of fileNodes) {
      const isSeed = seedSet.has(node.id);
      const prefix = isSeed ? '[TARGET] ' : '';
      const loc = node.location ? `:${node.location.startLine}` : '';

      if (isSeed || !includeSignatures) {
        // Full content for seed nodes
        sections.push(`${prefix}${node.type} ${node.name}${loc}`);
        if (node.signature) sections.push(`  signature: ${node.signature}`);
        if (node.content) sections.push(node.content);
      } else {
        // Signature-only for related nodes (saves tokens)
        sections.push(`${node.type} ${node.name}${loc}`);
        if (node.signature) sections.push(`  signature: ${node.signature}`);
      }
      sections.push('');
    }
  }

  // Doc/virtual nodes without file location
  if (noFile.length > 0) {
    sections.push('--- Related Documentation ---');
    for (const node of noFile) {
      sections.push(`${node.type}: ${node.name}`);
      sections.push(node.content);
      sections.push('');
    }
  }

  return sections.join('\n');
}

/**
 * Get context for a symbol by name (consumer-friendly API).
 * This is what MCP tools call internally.
 */
export function getContextForSymbol(
  graph: CodeGraph,
  symbolName: string,
  options: ContextOptions & { file?: string } = { maxTokens: 4000 },
): ContextResult | null {
  const node = graph.resolve(symbolName, options.file);
  if (!node) return null;
  return buildContext(graph, [node.id], options);
}

/**
 * Get context for a file (all top-level symbols).
 */
export function getContextForFile(
  graph: CodeGraph,
  filePath: string,
  options: ContextOptions = { maxTokens: 4000 },
): ContextResult | null {
  const fileNodes = graph.findByFile(filePath);
  if (fileNodes.length === 0) return null;

  // Use file node as seed, or first top-level node
  const fileNode = fileNodes.find((n) => n.type === 'file');
  const seedIds = fileNode ? [fileNode.id] : fileNodes.slice(0, 3).map((n) => n.id);

  return buildContext(graph, seedIds, options);
}
