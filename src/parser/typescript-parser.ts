import type { ParseResult, ParsedNodeInfo, ParsedEdgeInfo, ParserOptions } from './types.js';
import { loadTypeScript } from './load-typescript.js';

/**
 * Parse a TypeScript/JavaScript source file into graph nodes and edges.
 *
 * Uses the TypeScript compiler API (optional peer dependency) to parse AST.
 * Falls back gracefully if typescript is not installed.
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

  const nodes: ParsedNodeInfo[] = [];
  const edges: ParsedEdgeInfo[] = [];

  // File node
  nodes.push({
    type: 'file',
    name: getFileName(filePath),
    qualifiedName: filePath,
    content: '',
    signature: '',
    startLine: 1,
    endLine: sourceCode.split('\n').length,
    startColumn: 0,
    endColumn: 0,
    metadata: { language: filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript' },
  });

  // Walk AST
  visitNode(sourceFile);

  function visitNode(node: import('typescript').Node) {
    const { line: startLine, character: startCol } =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine, character: endCol } =
      sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      const qualifiedName = `${filePath}#${name}`;
      const sig = getFunctionSignature(node, sourceFile, ts);
      const content = includeBody
        ? truncate(node.getText(sourceFile), maxContentLength)
        : sig;
      const jsdoc = includeJSDoc ? getJSDoc(node, sourceFile, ts) : '';

      nodes.push({
        type: 'function',
        name,
        qualifiedName,
        content,
        signature: sig,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        metadata: jsdoc ? { jsdoc } : {},
      });

      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: qualifiedName,
        type: 'contains',
      });

      // Check if exported
      if (hasExportModifier(node, ts)) {
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: qualifiedName,
          type: 'exports',
        });
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      const qualifiedName = `${filePath}#${name}`;
      const content = includeBody
        ? truncate(node.getText(sourceFile), maxContentLength)
        : `class ${name}`;

      const metadata: Record<string, unknown> = {};
      if (includeJSDoc) {
        const jsdoc = getJSDoc(node, sourceFile, ts);
        if (jsdoc) metadata['jsdoc'] = jsdoc;
      }

      nodes.push({
        type: 'class',
        name,
        qualifiedName,
        content,
        signature: `class ${name}`,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        metadata,
      });

      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: qualifiedName,
        type: 'contains',
      });

      if (hasExportModifier(node, ts)) {
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: qualifiedName,
          type: 'exports',
        });
      }

      // Heritage clauses (extends, implements)
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          const clauseType =
            clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
          for (const typeNode of clause.types) {
            const baseTypeName = typeNode.expression.getText(sourceFile);
            edges.push({
              sourceQualifiedName: qualifiedName,
              targetQualifiedName: baseTypeName, // resolved later
              type: clauseType,
            });
          }
        }
      }

      // Methods
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(sourceFile);
          const methodQualifiedName = `${qualifiedName}.${methodName}`;
          const methodSig = getFunctionSignature(member, sourceFile, ts);
          const methodContent = includeBody
            ? truncate(member.getText(sourceFile), maxContentLength)
            : methodSig;

          const { line: mStartLine, character: mStartCol } =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
          const { line: mEndLine, character: mEndCol } =
            sourceFile.getLineAndCharacterOfPosition(member.getEnd());

          nodes.push({
            type: 'function',
            name: methodName,
            qualifiedName: methodQualifiedName,
            content: methodContent,
            signature: methodSig,
            startLine: mStartLine + 1,
            endLine: mEndLine + 1,
            startColumn: mStartCol,
            endColumn: mEndCol,
            metadata: {},
          });

          edges.push({
            sourceQualifiedName: qualifiedName,
            targetQualifiedName: methodQualifiedName,
            type: 'contains',
          });
        }
      }
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          const name = decl.name.text;
          const qualifiedName = `${filePath}#${name}`;
          const isConst =
            (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
          const content = truncate(decl.getText(sourceFile), maxContentLength);

          const { line: vStartLine, character: vStartCol } =
            sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
          const { line: vEndLine, character: vEndCol } =
            sourceFile.getLineAndCharacterOfPosition(decl.getEnd());

          nodes.push({
            type: 'variable',
            name,
            qualifiedName,
            content,
            signature: `${isConst ? 'const' : 'let'} ${name}`,
            startLine: vStartLine + 1,
            endLine: vEndLine + 1,
            startColumn: vStartCol,
            endColumn: vEndCol,
            metadata: { isConst },
          });

          edges.push({
            sourceQualifiedName: filePath,
            targetQualifiedName: qualifiedName,
            type: 'contains',
          });

          if (hasExportModifier(node, ts)) {
            edges.push({
              sourceQualifiedName: filePath,
              targetQualifiedName: qualifiedName,
              type: 'exports',
            });
          }
        }
      }
    }

    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const qualifiedName = `${filePath}#${name}`;
      const content = truncate(node.getText(sourceFile), maxContentLength);

      nodes.push({
        type: 'type',
        name,
        qualifiedName,
        content,
        signature: ts.isInterfaceDeclaration(node)
          ? `interface ${name}`
          : `type ${name}`,
        startLine: startLine + 1,
        endLine: endLine + 1,
        startColumn: startCol,
        endColumn: endCol,
        metadata: {},
      });

      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: qualifiedName,
        type: 'contains',
      });

      if (hasExportModifier(node, ts)) {
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: qualifiedName,
          type: 'exports',
        });
      }
    }

    // Import declarations
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as import('typescript').StringLiteral).text;
      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: moduleSpecifier,
        type: 'imports',
      });
    }

    // Only recurse into top-level statements (not into function/class bodies for top-level extraction)
    if (ts.isSourceFile(node)) {
      ts.forEachChild(node, visitNode);
    }
  }

  return { nodes, edges };
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
  // Remove existing nodes for this file (incremental re-index)
  graph.removeFile(filePath);

  const { nodes, edges } = parseTypeScriptSource(filePath, sourceCode, options);

  // Add all nodes
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

  // Add edges (skip if nodes don't exist — e.g. external imports)
  for (const edgeInfo of edges) {
    const source = graph.resolve(edgeInfo.sourceQualifiedName);
    const target = graph.resolve(edgeInfo.targetQualifiedName);
    if (source && target) {
      graph.addEdge({
        source: source.id,
        target: target.id,
        type: edgeInfo.type,
      });
    }
  }

  return nodes.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? filePath;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (truncated)';
}

function getFunctionSignature(
  node: import('typescript').FunctionDeclaration | import('typescript').MethodDeclaration,
  sourceFile: import('typescript').SourceFile,
  ts: typeof import('typescript'),
): string {
  const name = node.name?.getText(sourceFile) ?? 'anonymous';
  const params = node.parameters
    .map((p) => p.getText(sourceFile))
    .join(', ');
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  return `${isAsync ? 'async ' : ''}function ${name}(${params})${returnType}`;
}

function getJSDoc(
  node: import('typescript').Node,
  _sourceFile: import('typescript').SourceFile,
  _ts: typeof import('typescript'),
): string {
  // Use node's leading comments as a simpler approach
  const fullText = node.getFullText();
  const trimmed = node.getText();
  const leading = fullText.slice(0, fullText.indexOf(trimmed));
  const jsDocMatch = leading.match(/\/\*\*[\s\S]*?\*\//);
  return jsDocMatch ? jsDocMatch[0] : '';
}

function hasExportModifier(
  node: import('typescript').Node,
  ts: typeof import('typescript'),
): boolean {
  const modifiers = (node as { modifiers?: import('typescript').NodeArray<import('typescript').ModifierLike> }).modifiers;
  if (!modifiers) return false;
  return modifiers.some(
    (m) => (m as import('typescript').Modifier).kind === ts.SyntaxKind.ExportKeyword,
  );
}
