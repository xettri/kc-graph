import type { ParseResult, ParserOptions } from './types.js';
import { loadTypeScript } from './load-typescript.js';
import { getFileName, countNewlines } from './helpers.js';
import { extractDeclarations } from './visitors/declarations.js';
import { extractImportsExports } from './visitors/imports-exports.js';
import { extractCalls } from './visitors/calls.js';
import { extractJsxReferences } from './visitors/jsx.js';

/**
 * Parse a TypeScript/JavaScript source file into graph nodes and edges.
 *
 * Delegates to composable visitors:
 * 1. declarations — functions, classes, variables, enums, interfaces, types
 * 2. imports-exports — all import/export shapes (default, named, namespace, re-exports)
 * 3. calls — call expressions from function bodies
 * 4. jsx — JSX component references in .tsx/.jsx files
 */
export function parseTypeScriptSource(
  filePath: string,
  sourceCode: string,
  options: ParserOptions = {},
): ParseResult {
  const includeBody = options.includeBody ?? true;
  const includeJSDoc = options.includeJSDoc ?? true;
  const maxContentLength = options.maxContentLength ?? 5000;

  const ts = loadTypeScript();
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
  const lineCount = countNewlines(sourceCode);

  const isJsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');

  // File node (always first)
  const fileNode = {
    type: 'file' as const,
    name: getFileName(filePath),
    qualifiedName: filePath,
    content: '',
    signature: '',
    startLine: 1,
    endLine: lineCount,
    startColumn: 0,
    endColumn: 0,
    metadata: {
      language: filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript',
    },
  };

  const opts = { includeBody, includeJSDoc, maxContentLength };

  // Run visitors
  const decls = extractDeclarations(sourceFile, filePath, ts, opts);
  const ie = extractImportsExports(sourceFile, filePath, ts, opts);
  const calls = extractCalls(sourceFile, filePath, ts, decls.declaredSymbols);
  const jsx = isJsx ? extractJsxReferences(sourceFile, filePath, ts) : { edges: [] };

  return {
    nodes: [fileNode, ...decls.nodes, ...ie.nodes],
    edges: [...decls.edges, ...ie.edges, ...calls.edges, ...jsx.edges],
  };
}

/**
 * Parse source and add all nodes/edges to a CodeGraph.
 * Returns the number of nodes added.
 */
export function indexSourceFile(
  graph: import('../core/graph.js').CodeGraph,
  filePath: string,
  sourceCode: string,
  options: ParserOptions = {},
): number {
  graph.removeFile(filePath);

  const { nodes, edges } = parseTypeScriptSource(filePath, sourceCode, options);

  for (const nodeInfo of nodes) {
    graph.addNode({
      type: nodeInfo.type,
      name: nodeInfo.name,
      qualifiedName: nodeInfo.qualifiedName,
      content: nodeInfo.content,
      signature: nodeInfo.signature,
      location: {
        file: filePath,
        startLine: nodeInfo.startLine,
        endLine: nodeInfo.endLine,
        startColumn: nodeInfo.startColumn,
        endColumn: nodeInfo.endColumn,
      },
      metadata: nodeInfo.metadata,
    });
  }

  for (const edgeInfo of edges) {
    const source = graph.resolve(edgeInfo.sourceQualifiedName);
    const target = graph.resolve(edgeInfo.targetQualifiedName);
    if (source && target) {
      try {
        graph.addEdge({
          source: source.id,
          target: target.id,
          type: edgeInfo.type,
          metadata: edgeInfo.metadata,
        });
      } catch {
        // Skip duplicate edges
      }
    }
  }

  return nodes.length;
}
