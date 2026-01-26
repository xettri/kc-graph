import type { ParseResult, ParsedNodeInfo, ParsedEdgeInfo, ParserOptions } from './types.js';
import { loadTypeScript } from './load-typescript.js';

/**
 * Parse a TypeScript/JavaScript source file into graph nodes and edges.
 *
 * Uses the TypeScript compiler API (optional peer dependency) to parse AST.
 * Extracts: functions, arrow functions, classes, methods, variables, types,
 * imports, exports, and call relationships.
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
  const lineCount = sourceCode.split('\n').length;

  const nodes: ParsedNodeInfo[] = [];
  const edges: ParsedEdgeInfo[] = [];

  // Track declared symbols for call resolution
  const declaredSymbols = new Set<string>();

  // File node
  nodes.push({
    type: 'file',
    name: getFileName(filePath),
    qualifiedName: filePath,
    content: '',
    signature: '',
    startLine: 1,
    endLine: lineCount,
    startColumn: 0,
    endColumn: 0,
    metadata: { language: filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript' },
  });

  // Phase 1: Walk top-level declarations
  ts.forEachChild(sourceFile, visitTopLevel);

  // Phase 2: Walk function/method bodies for call edges
  ts.forEachChild(sourceFile, (node) => extractCalls(node, filePath));

  return { nodes, edges };

  // -----------------------------------------------------------------------
  // Phase 1: Declaration extraction
  // -----------------------------------------------------------------------

  function visitTopLevel(node: import('typescript').Node) {
    const { line: startLine, character: startCol } =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine, character: endCol } =
      sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    // Function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      addFunctionNode(node.name.text, filePath, node, startLine, endLine, startCol, endCol);
    }

    // Class declarations
    else if (ts.isClassDeclaration(node) && node.name) {
      addClassNode(node, startLine, endLine, startCol, endCol);
    }

    // Variable statements (const/let/var — may contain arrow functions)
    else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;

        const name = decl.name.text;
        const qualifiedName = `${filePath}#${name}`;
        const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

        const { line: vStartLine, character: vStartCol } =
          sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
        const { line: vEndLine, character: vEndCol } =
          sourceFile.getLineAndCharacterOfPosition(decl.getEnd());

        // Check if initializer is an arrow function or function expression
        if (decl.initializer && isArrowOrFunctionExpr(decl.initializer)) {
          const sig = getArrowSignature(name, decl.initializer, sourceFile, ts);
          const content = includeBody
            ? truncate(decl.getText(sourceFile), maxContentLength)
            : sig;
          const jsdoc = includeJSDoc ? getJSDoc(node, sourceFile) : '';

          nodes.push({
            type: 'function',
            name,
            qualifiedName,
            content,
            signature: sig,
            startLine: vStartLine + 1,
            endLine: vEndLine + 1,
            startColumn: vStartCol,
            endColumn: vEndCol,
            metadata: jsdoc ? { jsdoc, isArrow: true } : { isArrow: true },
          });

          declaredSymbols.add(qualifiedName);

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
        } else {
          // Regular variable
          const content = truncate(decl.getText(sourceFile), maxContentLength);

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

          declaredSymbols.add(qualifiedName);

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

    // Type alias and interface declarations
    else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
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

      declaredSymbols.add(qualifiedName);

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
    else if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = (node.moduleSpecifier as import('typescript').StringLiteral).text;
      const resolvedModule = resolveModulePath(filePath, moduleSpecifier);

      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: resolvedModule,
        type: 'imports',
      });

      // Named imports create references to specific symbols
      if (node.importClause) {
        const clause = node.importClause;
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            const importedName = (spec.propertyName ?? spec.name).text;
            edges.push({
              sourceQualifiedName: filePath,
              targetQualifiedName: `${resolvedModule}#${importedName}`,
              type: 'imports',
            });
          }
        }
      }
    }

    // Export declarations: export { foo, bar } or export { foo } from './mod'
    else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const moduleSpecifier = (node.moduleSpecifier as import('typescript').StringLiteral).text;
        const resolvedModule = resolveModulePath(filePath, moduleSpecifier);

        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          // export { foo, bar } from './mod' — re-exports
          for (const spec of node.exportClause.elements) {
            const originalName = (spec.propertyName ?? spec.name).text;

            edges.push({
              sourceQualifiedName: filePath,
              targetQualifiedName: `${resolvedModule}#${originalName}`,
              type: 'imports',
            });
            edges.push({
              sourceQualifiedName: filePath,
              targetQualifiedName: `${resolvedModule}#${originalName}`,
              type: 'exports',
            });
          }
        } else {
          // export * from './mod'
          edges.push({
            sourceQualifiedName: filePath,
            targetQualifiedName: resolvedModule,
            type: 'exports',
          });
        }
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        // export { foo, bar } — local re-export
        for (const spec of node.exportClause.elements) {
          const name = (spec.propertyName ?? spec.name).text;
          edges.push({
            sourceQualifiedName: filePath,
            targetQualifiedName: `${filePath}#${name}`,
            type: 'exports',
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Class node extraction
  // -----------------------------------------------------------------------

  function addClassNode(
    node: import('typescript').ClassDeclaration,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number,
  ) {
    const name = node.name!.text;
    const qualifiedName = `${filePath}#${name}`;
    const content = includeBody
      ? truncate(node.getText(sourceFile), maxContentLength)
      : `class ${name}`;

    const metadata: Record<string, unknown> = {};
    if (includeJSDoc) {
      const jsdoc = getJSDoc(node, sourceFile);
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

    declaredSymbols.add(qualifiedName);

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

    // Heritage clauses
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        const clauseType =
          clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
        for (const typeNode of clause.types) {
          const baseTypeName = typeNode.expression.getText(sourceFile);
          edges.push({
            sourceQualifiedName: qualifiedName,
            targetQualifiedName: baseTypeName,
            type: clauseType,
          });
        }
      }
    }

    // Methods and properties
    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const methodName = member.name.getText(sourceFile);
        const methodQN = `${qualifiedName}.${methodName}`;
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
          qualifiedName: methodQN,
          content: methodContent,
          signature: methodSig,
          startLine: mStartLine + 1,
          endLine: mEndLine + 1,
          startColumn: mStartCol,
          endColumn: mEndCol,
          metadata: {},
        });

        declaredSymbols.add(methodQN);

        edges.push({
          sourceQualifiedName: qualifiedName,
          targetQualifiedName: methodQN,
          type: 'contains',
        });
      }

      // Constructor
      if (ts.isConstructorDeclaration(member)) {
        const ctorQN = `${qualifiedName}.constructor`;
        const ctorSig = `constructor(${member.parameters.map(p => p.getText(sourceFile)).join(', ')})`;
        const ctorContent = includeBody
          ? truncate(member.getText(sourceFile), maxContentLength)
          : ctorSig;

        const { line: cStartLine, character: cStartCol } =
          sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
        const { line: cEndLine, character: cEndCol } =
          sourceFile.getLineAndCharacterOfPosition(member.getEnd());

        nodes.push({
          type: 'function',
          name: 'constructor',
          qualifiedName: ctorQN,
          content: ctorContent,
          signature: ctorSig,
          startLine: cStartLine + 1,
          endLine: cEndLine + 1,
          startColumn: cStartCol,
          endColumn: cEndCol,
          metadata: { isConstructor: true },
        });

        declaredSymbols.add(ctorQN);

        edges.push({
          sourceQualifiedName: qualifiedName,
          targetQualifiedName: ctorQN,
          type: 'contains',
        });
      }

      // Properties with arrow function initializers (class fields)
      if (ts.isPropertyDeclaration(member) && member.name && member.initializer) {
        if (isArrowOrFunctionExpr(member.initializer)) {
          const propName = member.name.getText(sourceFile);
          const propQN = `${qualifiedName}.${propName}`;
          const sig = getArrowSignature(propName, member.initializer, sourceFile, ts);

          const { line: pStartLine, character: pStartCol } =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
          const { line: pEndLine, character: pEndCol } =
            sourceFile.getLineAndCharacterOfPosition(member.getEnd());

          nodes.push({
            type: 'function',
            name: propName,
            qualifiedName: propQN,
            content: includeBody
              ? truncate(member.getText(sourceFile), maxContentLength)
              : sig,
            signature: sig,
            startLine: pStartLine + 1,
            endLine: pEndLine + 1,
            startColumn: pStartCol,
            endColumn: pEndCol,
            metadata: { isArrow: true },
          });

          declaredSymbols.add(propQN);

          edges.push({
            sourceQualifiedName: qualifiedName,
            targetQualifiedName: propQN,
            type: 'contains',
          });
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Function node helper
  // -----------------------------------------------------------------------

  function addFunctionNode(
    name: string,
    file: string,
    node: import('typescript').FunctionDeclaration,
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number,
  ) {
    const qualifiedName = `${file}#${name}`;
    const sig = getFunctionSignature(node, sourceFile, ts);
    const content = includeBody
      ? truncate(node.getText(sourceFile), maxContentLength)
      : sig;
    const jsdoc = includeJSDoc ? getJSDoc(node, sourceFile) : '';

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

    declaredSymbols.add(qualifiedName);

    edges.push({
      sourceQualifiedName: file,
      targetQualifiedName: qualifiedName,
      type: 'contains',
    });

    if (hasExportModifier(node, ts)) {
      edges.push({
        sourceQualifiedName: file,
        targetQualifiedName: qualifiedName,
        type: 'exports',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Phase 2: Call extraction — walk function bodies for call expressions
  // -----------------------------------------------------------------------

  function extractCalls(node: import('typescript').Node, containerQN: string) {
    // Determine the qualified name of the current container
    let currentContainer = containerQN;

    if (ts.isFunctionDeclaration(node) && node.name) {
      currentContainer = `${filePath}#${node.name.text}`;
    } else if (ts.isClassDeclaration(node) && node.name) {
      currentContainer = `${filePath}#${node.name.text}`;
      // Recurse into class members
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText(sourceFile);
          extractCallsFromBody(member, `${currentContainer}.${methodName}`);
        } else if (ts.isConstructorDeclaration(member)) {
          extractCallsFromBody(member, `${currentContainer}.constructor`);
        } else if (ts.isPropertyDeclaration(member) && member.initializer && isArrowOrFunctionExpr(member.initializer)) {
          const propName = member.name?.getText(sourceFile);
          if (propName) extractCallsFromBody(member.initializer, `${currentContainer}.${propName}`);
        }
      }
      return;
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          const varName = decl.name.text;
          if (isArrowOrFunctionExpr(decl.initializer)) {
            extractCallsFromBody(decl.initializer, `${filePath}#${varName}`);
          }
        }
      }
      return;
    }

    // For top-level function declarations, walk the body
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      extractCallsFromBody(node, currentContainer);
      return;
    }

    // Default: recurse for other top-level nodes
    if (ts.isSourceFile(node)) {
      ts.forEachChild(node, (child) => extractCalls(child, containerQN));
    }
  }

  function extractCallsFromBody(node: import('typescript').Node, containerQN: string) {
    walkForCalls(node, containerQN);
  }

  function walkForCalls(node: import('typescript').Node, containerQN: string) {
    if (ts.isCallExpression(node)) {
      const callee = resolveCallTarget(node.expression);
      if (callee && callee !== containerQN) {
        edges.push({
          sourceQualifiedName: containerQN,
          targetQualifiedName: callee,
          type: 'calls',
        });
      }
    }

    // Also detect new expressions: new Foo()
    if (ts.isNewExpression(node)) {
      const callee = resolveCallTarget(node.expression);
      if (callee) {
        edges.push({
          sourceQualifiedName: containerQN,
          targetQualifiedName: callee,
          type: 'calls',
        });
      }
    }

    ts.forEachChild(node, (child) => walkForCalls(child, containerQN));
  }

  function resolveCallTarget(expr: import('typescript').Expression): string | null {
    // foo() → filePath#foo
    if (ts.isIdentifier(expr)) {
      const name = expr.text;
      const candidate = `${filePath}#${name}`;
      // Check if it's a known local symbol
      if (declaredSymbols.has(candidate)) return candidate;
      // Return the name as-is for cross-file resolution in indexSourceFile
      return name;
    }

    // this.method() or obj.method() → try to resolve
    if (ts.isPropertyAccessExpression(expr)) {
      const methodName = expr.name.text;
      const obj = expr.expression;

      // this.method() inside a class
      if (obj.kind === ts.SyntaxKind.ThisKeyword) {
        // Will be resolved by graph.resolve() later
        return methodName;
      }

      // Foo.bar() — static call or imported object method
      if (ts.isIdentifier(obj)) {
        return `${obj.text}.${methodName}`;
      }
    }

    return null;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function isArrowOrFunctionExpr(node: import('typescript').Node): boolean {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  }
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

  // Add edges (skip if target nodes don't exist — e.g. external imports)
  for (const edgeInfo of edges) {
    const source = graph.resolve(edgeInfo.sourceQualifiedName);
    const target = graph.resolve(edgeInfo.targetQualifiedName);
    if (source && target) {
      try {
        graph.addEdge({
          source: source.id,
          target: target.id,
          type: edgeInfo.type,
        });
      } catch {
        // Skip duplicate edges (e.g. multiple calls to the same function)
      }
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

function getArrowSignature(
  name: string,
  node: import('typescript').Node,
  sourceFile: import('typescript').SourceFile,
  ts: typeof import('typescript'),
): string {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const params = node.parameters
      .map((p: import('typescript').ParameterDeclaration) => p.getText(sourceFile))
      .join(', ');
    const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
    const isAsync = node.modifiers?.some((m: import('typescript').ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword);
    return `${isAsync ? 'async ' : ''}const ${name} = (${params})${returnType}`;
  }
  return `const ${name}`;
}

function getJSDoc(
  node: import('typescript').Node,
  _sourceFile: import('typescript').SourceFile,
): string {
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

/**
 * Resolve a relative module specifier to a file path.
 * Handles ./foo → dir/foo.ts resolution.
 * Non-relative imports (bare specifiers like 'lodash') are returned as-is.
 */
function resolveModulePath(fromFile: string, specifier: string): string {
  // Bare specifiers (node_modules) stay as-is
  if (!specifier.startsWith('.')) return specifier;

  // Get the directory of the importing file
  const lastSlash = fromFile.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : fromFile.slice(0, lastSlash);

  // Resolve the relative path
  const parts = (dir ? dir + '/' + specifier : specifier).split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  let result = resolved.join('/');

  // Add .ts extension if no extension present (common convention)
  if (!result.match(/\.[a-zA-Z]+$/)) {
    result += '.ts';
  }

  return result;
}
