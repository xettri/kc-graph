/**
 * Declaration extraction visitor.
 * Extracts: functions, classes, variables, enums, interfaces, types.
 */
import type { ParsedNodeInfo, ParsedEdgeInfo } from '../types.js';
import {
  truncate,
  getFunctionSignature,
  getArrowSignature,
  getJSDoc,
  hasExportModifier,
  hasDefaultModifier,
  isArrowOrFunctionExpr,
  getNodePosition,
} from '../helpers.js';

type TS = typeof import('typescript');

export interface DeclarationResult {
  nodes: ParsedNodeInfo[];
  edges: ParsedEdgeInfo[];
  declaredSymbols: Set<string>;
}

export function extractDeclarations(
  sourceFile: import('typescript').SourceFile,
  filePath: string,
  ts: TS,
  options: { includeBody: boolean; includeJSDoc: boolean; maxContentLength: number },
): DeclarationResult {
  const { includeBody, includeJSDoc, maxContentLength } = options;
  const nodes: ParsedNodeInfo[] = [];
  const edges: ParsedEdgeInfo[] = [];
  const declaredSymbols = new Set<string>();

  ts.forEachChild(sourceFile, (node) => visitTopLevel(node));

  return { nodes, edges, declaredSymbols };

  function visitTopLevel(node: import('typescript').Node) {
    const pos = getNodePosition(node, sourceFile);

    // Function declarations (named or anonymous default export)
    if (ts.isFunctionDeclaration(node)) {
      const name = node.name?.text ?? 'default';
      addFunctionNode(name, node, pos);
      if (!node.name && hasDefaultModifier(node, ts)) {
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: `${filePath}#${name}`,
          type: 'exports',
        });
      }
    }

    // Class declarations (named or anonymous default export)
    else if (ts.isClassDeclaration(node)) {
      if (!node.name && hasDefaultModifier(node, ts)) {
        addAnonymousDefaultClass(node, pos);
      } else if (node.name) {
        addClassNode(node, pos);
      }
    }

    // Variable statements
    else if (ts.isVariableStatement(node)) {
      handleVariableStatement(node);
    }

    // Interface and type alias
    else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      addTypeNode(node, pos);
    }

    // Enum
    else if (ts.isEnumDeclaration(node)) {
      addEnumNode(node, pos);
    }
  }

  // ---------------------------------------------------------------------------
  // Functions
  // ---------------------------------------------------------------------------

  function addFunctionNode(
    name: string,
    node: import('typescript').FunctionDeclaration,
    pos: ReturnType<typeof getNodePosition>,
  ) {
    const qualifiedName = `${filePath}#${name}`;
    const sig = getFunctionSignature(node, sourceFile, ts);
    const content = includeBody ? truncate(node.getText(sourceFile), maxContentLength) : sig;
    const jsdoc = includeJSDoc ? getJSDoc(node, sourceFile) : '';

    nodes.push({
      type: 'function',
      name,
      qualifiedName,
      content,
      signature: sig,
      startLine: pos.startLine,
      endLine: pos.endLine,
      startColumn: pos.startCol,
      endColumn: pos.endCol,
      metadata: jsdoc ? { jsdoc } : {},
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

  // ---------------------------------------------------------------------------
  // Classes
  // ---------------------------------------------------------------------------

  function addClassNode(
    node: import('typescript').ClassDeclaration,
    pos: ReturnType<typeof getNodePosition>,
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
      startLine: pos.startLine,
      endLine: pos.endLine,
      startColumn: pos.startCol,
      endColumn: pos.endCol,
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

    extractHeritageAndMembers(node, qualifiedName);
  }

  function addAnonymousDefaultClass(
    node: import('typescript').ClassDeclaration,
    pos: ReturnType<typeof getNodePosition>,
  ) {
    const name = 'default';
    const qualifiedName = `${filePath}#${name}`;

    nodes.push({
      type: 'class',
      name,
      qualifiedName,
      content: truncate(node.getText(sourceFile), maxContentLength),
      signature: `class ${name}`,
      startLine: pos.startLine,
      endLine: pos.endLine,
      startColumn: pos.startCol,
      endColumn: pos.endCol,
      metadata: { isDefaultExport: true },
    });

    declaredSymbols.add(qualifiedName);
    edges.push({
      sourceQualifiedName: filePath,
      targetQualifiedName: qualifiedName,
      type: 'contains',
    });
    edges.push({
      sourceQualifiedName: filePath,
      targetQualifiedName: qualifiedName,
      type: 'exports',
    });

    extractHeritageAndMembers(node, qualifiedName);
  }

  function extractHeritageAndMembers(node: import('typescript').ClassDeclaration, classQN: string) {
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        const edgeType = clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
        for (const typeNode of clause.types) {
          edges.push({
            sourceQualifiedName: classQN,
            targetQualifiedName: typeNode.expression.getText(sourceFile),
            type: edgeType,
          });
        }
      }
    }

    for (const member of node.members) {
      if (ts.isMethodDeclaration(member) && member.name) {
        const methodName = member.name.getText(sourceFile);
        const methodQN = `${classQN}.${methodName}`;
        const methodSig = getFunctionSignature(member, sourceFile, ts);
        const mPos = getNodePosition(member, sourceFile);

        nodes.push({
          type: 'function',
          name: methodName,
          qualifiedName: methodQN,
          content: includeBody ? truncate(member.getText(sourceFile), maxContentLength) : methodSig,
          signature: methodSig,
          startLine: mPos.startLine,
          endLine: mPos.endLine,
          startColumn: mPos.startCol,
          endColumn: mPos.endCol,
          metadata: {},
        });
        declaredSymbols.add(methodQN);
        edges.push({
          sourceQualifiedName: classQN,
          targetQualifiedName: methodQN,
          type: 'contains',
        });
      }

      if (ts.isConstructorDeclaration(member)) {
        const ctorQN = `${classQN}.constructor`;
        const ctorSig = `constructor(${member.parameters.map((p) => p.getText(sourceFile)).join(', ')})`;
        const cPos = getNodePosition(member, sourceFile);

        nodes.push({
          type: 'function',
          name: 'constructor',
          qualifiedName: ctorQN,
          content: includeBody ? truncate(member.getText(sourceFile), maxContentLength) : ctorSig,
          signature: ctorSig,
          startLine: cPos.startLine,
          endLine: cPos.endLine,
          startColumn: cPos.startCol,
          endColumn: cPos.endCol,
          metadata: { isConstructor: true },
        });
        declaredSymbols.add(ctorQN);
        edges.push({ sourceQualifiedName: classQN, targetQualifiedName: ctorQN, type: 'contains' });
      }

      if (ts.isPropertyDeclaration(member) && member.name && member.initializer) {
        if (isArrowOrFunctionExpr(member.initializer, ts)) {
          const propName = member.name.getText(sourceFile);
          const propQN = `${classQN}.${propName}`;
          const sig = getArrowSignature(propName, member.initializer, sourceFile, ts);
          const pPos = getNodePosition(member, sourceFile);

          nodes.push({
            type: 'function',
            name: propName,
            qualifiedName: propQN,
            content: includeBody ? truncate(member.getText(sourceFile), maxContentLength) : sig,
            signature: sig,
            startLine: pPos.startLine,
            endLine: pPos.endLine,
            startColumn: pPos.startCol,
            endColumn: pPos.endCol,
            metadata: { isArrow: true },
          });
          declaredSymbols.add(propQN);
          edges.push({
            sourceQualifiedName: classQN,
            targetQualifiedName: propQN,
            type: 'contains',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Variables (simple + destructured)
  // ---------------------------------------------------------------------------

  function handleVariableStatement(node: import('typescript').VariableStatement) {
    const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const isExported = hasExportModifier(node, ts);

    for (const decl of node.declarationList.declarations) {
      // Destructured: const [a, b] = ... or const { x, y } = ...
      if (ts.isArrayBindingPattern(decl.name) || ts.isObjectBindingPattern(decl.name)) {
        const content = truncate(decl.getText(sourceFile), maxContentLength);

        for (const element of decl.name.elements) {
          if (ts.isOmittedExpression(element)) continue;
          const bindingName =
            ts.isBindingElement(element) && ts.isIdentifier(element.name)
              ? element.name.text
              : null;
          if (!bindingName) continue;

          const qualifiedName = `${filePath}#${bindingName}`;
          const bPos = getNodePosition(element, sourceFile);

          nodes.push({
            type: 'variable',
            name: bindingName,
            qualifiedName,
            content,
            signature: `${isConst ? 'const' : 'let'} ${bindingName}`,
            startLine: bPos.startLine,
            endLine: bPos.endLine,
            startColumn: bPos.startCol,
            endColumn: bPos.endCol,
            metadata: { isConst, isDestructured: true },
          });
          declaredSymbols.add(qualifiedName);
          edges.push({
            sourceQualifiedName: filePath,
            targetQualifiedName: qualifiedName,
            type: 'contains',
          });
          if (isExported) {
            edges.push({
              sourceQualifiedName: filePath,
              targetQualifiedName: qualifiedName,
              type: 'exports',
            });
          }
        }
        continue;
      }

      if (!ts.isIdentifier(decl.name)) continue;

      const name = decl.name.text;
      const qualifiedName = `${filePath}#${name}`;
      const vPos = getNodePosition(decl, sourceFile);

      if (decl.initializer && isArrowOrFunctionExpr(decl.initializer, ts)) {
        const sig = getArrowSignature(name, decl.initializer, sourceFile, ts);
        const content = includeBody ? truncate(decl.getText(sourceFile), maxContentLength) : sig;
        const jsdoc = includeJSDoc ? getJSDoc(node, sourceFile) : '';

        nodes.push({
          type: 'function',
          name,
          qualifiedName,
          content,
          signature: sig,
          startLine: vPos.startLine,
          endLine: vPos.endLine,
          startColumn: vPos.startCol,
          endColumn: vPos.endCol,
          metadata: jsdoc ? { jsdoc, isArrow: true } : { isArrow: true },
        });
      } else {
        const content = truncate(decl.getText(sourceFile), maxContentLength);

        nodes.push({
          type: 'variable',
          name,
          qualifiedName,
          content,
          signature: `${isConst ? 'const' : 'let'} ${name}`,
          startLine: vPos.startLine,
          endLine: vPos.endLine,
          startColumn: vPos.startCol,
          endColumn: vPos.endCol,
          metadata: { isConst },
        });
      }

      declaredSymbols.add(qualifiedName);
      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: qualifiedName,
        type: 'contains',
      });
      if (isExported) {
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: qualifiedName,
          type: 'exports',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Types, interfaces, enums
  // ---------------------------------------------------------------------------

  function addTypeNode(
    node: import('typescript').InterfaceDeclaration | import('typescript').TypeAliasDeclaration,
    pos: ReturnType<typeof getNodePosition>,
  ) {
    const name = node.name.text;
    const qualifiedName = `${filePath}#${name}`;
    const content = truncate(node.getText(sourceFile), maxContentLength);

    nodes.push({
      type: 'type',
      name,
      qualifiedName,
      content,
      signature: ts.isInterfaceDeclaration(node) ? `interface ${name}` : `type ${name}`,
      startLine: pos.startLine,
      endLine: pos.endLine,
      startColumn: pos.startCol,
      endColumn: pos.endCol,
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

  function addEnumNode(
    node: import('typescript').EnumDeclaration,
    pos: ReturnType<typeof getNodePosition>,
  ) {
    const name = node.name.text;
    const qualifiedName = `${filePath}#${name}`;
    const content = truncate(node.getText(sourceFile), maxContentLength);
    const members = node.members.map((m) => m.name.getText(sourceFile));

    nodes.push({
      type: 'type',
      name,
      qualifiedName,
      content,
      signature: `enum ${name}`,
      startLine: pos.startLine,
      endLine: pos.endLine,
      startColumn: pos.startCol,
      endColumn: pos.endCol,
      metadata: { isEnum: true, members },
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
