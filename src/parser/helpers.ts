/**
 * Shared helper utilities for the TypeScript parser visitors.
 */

type TS = typeof import('typescript');

export function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? filePath;
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (truncated)';
}

export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1 || lastDot < filePath.lastIndexOf('/')) return '';
  return filePath.slice(lastDot);
}

export function countNewlines(source: string): number {
  let count = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) count++;
  }
  return count;
}

export function getFunctionSignature(
  node: import('typescript').FunctionDeclaration | import('typescript').MethodDeclaration,
  sourceFile: import('typescript').SourceFile,
  ts: TS,
): string {
  const name = node.name?.getText(sourceFile) ?? 'anonymous';
  const params = node.parameters.map((p) => p.getText(sourceFile)).join(', ');
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  const isAsync = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  return `${isAsync ? 'async ' : ''}function ${name}(${params})${returnType}`;
}

export function getArrowSignature(
  name: string,
  node: import('typescript').Node,
  sourceFile: import('typescript').SourceFile,
  ts: TS,
): string {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const params = node.parameters
      .map((p: import('typescript').ParameterDeclaration) => p.getText(sourceFile))
      .join(', ');
    const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
    const isAsync = node.modifiers?.some(
      (m: import('typescript').ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword,
    );
    return `${isAsync ? 'async ' : ''}const ${name} = (${params})${returnType}`;
  }
  return `const ${name}`;
}

export function getJSDoc(
  node: import('typescript').Node,
  _sourceFile: import('typescript').SourceFile,
): string {
  const fullText = node.getFullText();
  const trimmed = node.getText();
  const leading = fullText.slice(0, fullText.indexOf(trimmed));
  const jsDocMatch = leading.match(/\/\*\*[\s\S]*?\*\//);
  return jsDocMatch ? jsDocMatch[0] : '';
}

export function hasExportModifier(node: import('typescript').Node, ts: TS): boolean {
  const modifiers = (
    node as { modifiers?: import('typescript').NodeArray<import('typescript').ModifierLike> }
  ).modifiers;
  if (!modifiers) return false;
  return modifiers.some(
    (m) => (m as import('typescript').Modifier).kind === ts.SyntaxKind.ExportKeyword,
  );
}

export function hasDefaultModifier(node: import('typescript').Node, ts: TS): boolean {
  const modifiers = (
    node as { modifiers?: import('typescript').NodeArray<import('typescript').ModifierLike> }
  ).modifiers;
  if (!modifiers) return false;
  return modifiers.some(
    (m) => (m as import('typescript').Modifier).kind === ts.SyntaxKind.DefaultKeyword,
  );
}

export function isArrowOrFunctionExpr(node: import('typescript').Node, ts: TS): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/**
 * Resolve a relative module specifier to a file path.
 * Infers extension from the importing file (so .tsx imports resolve to .tsx, etc.).
 */
export function resolveModulePath(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;

  const lastSlash = fromFile.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : fromFile.slice(0, lastSlash);

  const parts = (dir ? dir + '/' + specifier : specifier).split('/');
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  let result = resolved.join('/');

  const lastDot = result.lastIndexOf('.');
  if (lastDot !== -1 && lastDot > result.lastIndexOf('/')) {
    return result;
  }

  const fromExt = getFileExtension(fromFile);
  if (fromExt === '.tsx' || fromExt === '.jsx') {
    result += fromExt === '.tsx' ? '.tsx' : '.jsx';
  } else if (fromExt === '.mts' || fromExt === '.mjs') {
    result += fromExt;
  } else {
    result += '.ts';
  }

  return result;
}

/**
 * Get start/end line+column for a node, 1-indexed.
 */
export function getNodePosition(
  node: import('typescript').Node,
  sourceFile: import('typescript').SourceFile,
): { startLine: number; endLine: number; startCol: number; endCol: number } {
  const { line: startLine, character: startCol } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const { line: endLine, character: endCol } = sourceFile.getLineAndCharacterOfPosition(
    node.getEnd(),
  );
  return { startLine: startLine + 1, endLine: endLine + 1, startCol, endCol };
}
