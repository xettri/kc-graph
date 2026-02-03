/**
 * Call expression extraction visitor.
 * Walks function/method bodies to find call edges (foo(), this.bar(), new Baz()).
 */
import type { ParsedEdgeInfo } from '../types.js';
import { isArrowOrFunctionExpr } from '../helpers.js';

type TS = typeof import('typescript');

export interface CallsResult {
  edges: ParsedEdgeInfo[];
}

export function extractCalls(
  sourceFile: import('typescript').SourceFile,
  filePath: string,
  ts: TS,
  declaredSymbols: Set<string>,
): CallsResult {
  const edges: ParsedEdgeInfo[] = [];

  ts.forEachChild(sourceFile, (node) => visitNode(node, filePath));

  return { edges };

  function visitNode(node: import('typescript').Node, containerQN: string) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const fnQN = `${filePath}#${node.name.text}`;
      if (node.body) walkForCalls(node, fnQN);
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const classQN = `${filePath}#${node.name.text}`;
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          walkForCalls(member, `${classQN}.${member.name.getText(sourceFile)}`);
        } else if (ts.isConstructorDeclaration(member)) {
          walkForCalls(member, `${classQN}.constructor`);
        } else if (
          ts.isPropertyDeclaration(member) &&
          member.initializer &&
          isArrowOrFunctionExpr(member.initializer, ts)
        ) {
          const propName = member.name?.getText(sourceFile);
          if (propName) walkForCalls(member.initializer, `${classQN}.${propName}`);
        }
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          if (isArrowOrFunctionExpr(decl.initializer, ts)) {
            walkForCalls(decl.initializer, `${filePath}#${decl.name.text}`);
          }
        }
      }
      return;
    }

    // For anonymous default export functions/arrows (handled via ExportAssignment)
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const expr = node.expression;
      if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
        const name = (expr as import('typescript').FunctionExpression).name?.text ?? 'default';
        walkForCalls(expr, `${filePath}#${name}`);
      }
      return;
    }

    if (ts.isSourceFile(node)) {
      ts.forEachChild(node, (child) => visitNode(child, containerQN));
    }
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
    if (ts.isIdentifier(expr)) {
      const name = expr.text;
      const candidate = `${filePath}#${name}`;
      if (declaredSymbols.has(candidate)) return candidate;
      return name;
    }

    if (ts.isPropertyAccessExpression(expr)) {
      const methodName = expr.name.text;
      const obj = expr.expression;

      if (obj.kind === ts.SyntaxKind.ThisKeyword) {
        return methodName;
      }

      if (ts.isIdentifier(obj)) {
        return `${obj.text}.${methodName}`;
      }
    }

    return null;
  }
}
