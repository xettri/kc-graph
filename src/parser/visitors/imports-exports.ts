/**
 * Import/export edge extraction visitor.
 * Handles all import shapes (default, named, namespace) and export declarations.
 */
import type { ParsedNodeInfo, ParsedEdgeInfo } from '../types.js';
import {
  truncate,
  getFunctionSignature,
  getArrowSignature,
  resolveModulePath,
  getNodePosition,
} from '../helpers.js';

type TS = typeof import('typescript');

export interface ImportsExportsResult {
  nodes: ParsedNodeInfo[];
  edges: ParsedEdgeInfo[];
}

export function extractImportsExports(
  sourceFile: import('typescript').SourceFile,
  filePath: string,
  ts: TS,
  options: { includeBody: boolean; maxContentLength: number },
): ImportsExportsResult {
  const nodes: ParsedNodeInfo[] = [];
  const edges: ParsedEdgeInfo[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      handleImport(node);
    } else if (ts.isExportDeclaration(node)) {
      handleExportDeclaration(node);
    } else if (ts.isExportAssignment(node) && !node.isExportEquals) {
      handleExportAssignment(node);
    }
  });

  return { nodes, edges };

  // ---------------------------------------------------------------------------
  // Imports
  // ---------------------------------------------------------------------------

  function handleImport(node: import('typescript').ImportDeclaration) {
    const moduleSpecifier = (node.moduleSpecifier as import('typescript').StringLiteral).text;
    const resolvedModule = resolveModulePath(filePath, moduleSpecifier);

    // File-level import edge
    edges.push({
      sourceQualifiedName: filePath,
      targetQualifiedName: resolvedModule,
      type: 'imports',
    });

    if (!node.importClause) return;
    const clause = node.importClause;

    // Default import: import Foo from './mod'
    if (clause.name) {
      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: `${resolvedModule}#default`,
        type: 'imports',
      });
    }

    if (clause.namedBindings) {
      if (ts.isNamedImports(clause.namedBindings)) {
        // Named imports: import { foo, bar } from './mod'
        for (const spec of clause.namedBindings.elements) {
          const importedName = (spec.propertyName ?? spec.name).text;
          edges.push({
            sourceQualifiedName: filePath,
            targetQualifiedName: `${resolvedModule}#${importedName}`,
            type: 'imports',
          });
        }
      } else if (ts.isNamespaceImport(clause.namedBindings)) {
        // Namespace import: import * as ns from './mod'
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: resolvedModule,
          type: 'imports',
          metadata: { namespace: clause.namedBindings.name.text },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Export declarations
  // ---------------------------------------------------------------------------

  function handleExportDeclaration(node: import('typescript').ExportDeclaration) {
    if (node.moduleSpecifier) {
      const moduleSpecifier = (node.moduleSpecifier as import('typescript').StringLiteral).text;
      const resolvedModule = resolveModulePath(filePath, moduleSpecifier);

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
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
        edges.push({
          sourceQualifiedName: filePath,
          targetQualifiedName: resolvedModule,
          type: 'exports',
        });
      }
    } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
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

  // ---------------------------------------------------------------------------
  // Export assignment: export default <expression>
  // ---------------------------------------------------------------------------

  function handleExportAssignment(node: import('typescript').ExportAssignment) {
    const expr = node.expression;
    const pos = getNodePosition(node, sourceFile);

    if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr)) {
      const name = (expr as import('typescript').FunctionExpression).name?.text ?? 'default';
      const qualifiedName = `${filePath}#${name}`;
      const sig = ts.isFunctionExpression(expr)
        ? getFunctionSignature(
            expr as unknown as import('typescript').FunctionDeclaration,
            sourceFile,
            ts,
          )
        : getArrowSignature(name, expr, sourceFile, ts);

      nodes.push({
        type: 'function',
        name,
        qualifiedName,
        content: options.includeBody
          ? truncate(expr.getText(sourceFile), options.maxContentLength)
          : sig,
        signature: sig,
        startLine: pos.startLine,
        endLine: pos.endLine,
        startColumn: pos.startCol,
        endColumn: pos.endCol,
        metadata: { isDefaultExport: true },
      });

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
    } else if (ts.isClassExpression(expr)) {
      const name = expr.name?.text ?? 'default';
      const qualifiedName = `${filePath}#${name}`;

      nodes.push({
        type: 'class',
        name,
        qualifiedName,
        content: truncate(expr.getText(sourceFile), options.maxContentLength),
        signature: `class ${name}`,
        startLine: pos.startLine,
        endLine: pos.endLine,
        startColumn: pos.startCol,
        endColumn: pos.endCol,
        metadata: { isDefaultExport: true },
      });

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
    } else if (ts.isIdentifier(expr)) {
      edges.push({
        sourceQualifiedName: filePath,
        targetQualifiedName: `${filePath}#${expr.text}`,
        type: 'exports',
      });
    }
  }
}
