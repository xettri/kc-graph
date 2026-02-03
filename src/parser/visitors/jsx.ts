/**
 * JSX component reference extraction.
 * Tracks <Component /> usage as 'references' edges in .tsx/.jsx files.
 * Only PascalCase tags are tracked (user components, not HTML intrinsics).
 */
import type { ParsedEdgeInfo } from '../types.js';

type TS = typeof import('typescript');

export interface JsxResult {
  edges: ParsedEdgeInfo[];
}

export function extractJsxReferences(
  sourceFile: import('typescript').SourceFile,
  filePath: string,
  ts: TS,
): JsxResult {
  const edges: ParsedEdgeInfo[] = [];

  walkForJsx(sourceFile);

  return { edges };

  function walkForJsx(node: import('typescript').Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      // PascalCase = user component; lowercase = HTML intrinsic
      if (tagName[0] && tagName[0] === tagName[0].toUpperCase() && /^[A-Z]/.test(tagName)) {
        const container = findContainingFunction(node);
        edges.push({
          sourceQualifiedName: container ?? filePath,
          targetQualifiedName: tagName,
          type: 'references',
        });
      }
    }
    ts.forEachChild(node, walkForJsx);
  }

  function findContainingFunction(node: import('typescript').Node): string | null {
    let current = node.parent;
    while (current) {
      if (ts.isFunctionDeclaration(current) && current.name) {
        return `${filePath}#${current.name.text}`;
      }
      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
        return `${filePath}#${current.name.text}`;
      }
      if (ts.isMethodDeclaration(current) && current.name) {
        const classNode = current.parent;
        if (ts.isClassDeclaration(classNode) && classNode.name) {
          return `${filePath}#${classNode.name.text}.${current.name.getText(sourceFile)}`;
        }
      }
      current = current.parent;
    }
    return null;
  }
}
