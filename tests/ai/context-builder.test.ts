import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { buildContext, getContextForSymbol, getContextForFile } from '../../src/ai/context-builder.js';

describe('Context Builder', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();

    // Build a realistic code graph
    graph.addNode({
      type: 'file',
      name: 'auth.ts',
      qualifiedName: 'src/auth.ts',
      location: { file: 'src/auth.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
    });

    graph.addNode({
      type: 'function',
      name: 'login',
      qualifiedName: 'src/auth.ts#login',
      content: 'async function login(user: string, pass: string): Promise<Token> {\n  const valid = validate(user, pass);\n  return generateToken(user);\n}',
      signature: 'async function login(user: string, pass: string): Promise<Token>',
      location: { file: 'src/auth.ts', startLine: 5, endLine: 8, startColumn: 0, endColumn: 0 },
    });

    graph.addNode({
      type: 'function',
      name: 'validate',
      qualifiedName: 'src/auth.ts#validate',
      content: 'function validate(user: string, pass: string): boolean { return true; }',
      signature: 'function validate(user: string, pass: string): boolean',
      location: { file: 'src/auth.ts', startLine: 10, endLine: 12, startColumn: 0, endColumn: 0 },
    });

    graph.addNode({
      type: 'function',
      name: 'generateToken',
      qualifiedName: 'src/auth.ts#generateToken',
      content: 'function generateToken(user: string): Token { return { token: "abc" }; }',
      signature: 'function generateToken(user: string): Token',
      location: { file: 'src/auth.ts', startLine: 14, endLine: 16, startColumn: 0, endColumn: 0 },
    });

    graph.addNode({
      type: 'doc',
      name: 'Auth Guide',
      qualifiedName: 'docs/auth.md#Auth Guide',
      content: 'The `login` function handles user authentication.',
    });

    // Edges
    graph.addEdge({ source: 'src/auth.ts', target: 'src/auth.ts#login', type: 'contains' });
    graph.addEdge({ source: 'src/auth.ts', target: 'src/auth.ts#validate', type: 'contains' });
    graph.addEdge({ source: 'src/auth.ts', target: 'src/auth.ts#generateToken', type: 'contains' });
    graph.addEdge({ source: 'src/auth.ts#login', target: 'src/auth.ts#validate', type: 'calls' });
    graph.addEdge({ source: 'src/auth.ts#login', target: 'src/auth.ts#generateToken', type: 'calls' });
  });

  describe('buildContext', () => {
    it('should include seed nodes', () => {
      const result = buildContext(graph, ['src/auth.ts#login'], { maxTokens: 10000 });
      expect(result.nodes.some((n) => n.name === 'login')).toBe(true);
    });

    it('should include related nodes', () => {
      const result = buildContext(graph, ['src/auth.ts#login'], { maxTokens: 10000 });
      expect(result.nodes.some((n) => n.name === 'validate')).toBe(true);
      expect(result.nodes.some((n) => n.name === 'generateToken')).toBe(true);
    });

    it('should respect token budget', () => {
      const result = buildContext(graph, ['src/auth.ts#login'], { maxTokens: 50 });
      expect(result.estimatedTokens).toBeLessThanOrEqual(50);
    });

    it('should produce formatted context string', () => {
      const result = buildContext(graph, ['src/auth.ts#login'], { maxTokens: 10000 });
      expect(result.context).toContain('[TARGET]');
      expect(result.context).toContain('login');
      expect(result.context).toContain('src/auth.ts');
    });

    it('should list impacted files', () => {
      const result = buildContext(graph, ['src/auth.ts#login'], { maxTokens: 10000 });
      expect(result.files).toContain('src/auth.ts');
    });
  });

  describe('getContextForSymbol', () => {
    it('should resolve symbol by name', () => {
      const result = getContextForSymbol(graph, 'login', { maxTokens: 10000 });
      expect(result).not.toBeNull();
      expect(result!.nodes.some((n) => n.name === 'login')).toBe(true);
    });

    it('should return null for unknown symbol', () => {
      const result = getContextForSymbol(graph, 'nonexistent', { maxTokens: 10000 });
      expect(result).toBeNull();
    });

    it('should narrow by file', () => {
      const result = getContextForSymbol(graph, 'login', {
        maxTokens: 10000,
        file: 'src/auth.ts',
      });
      expect(result).not.toBeNull();
    });
  });

  describe('getContextForFile', () => {
    it('should return context for all symbols in a file', () => {
      const result = getContextForFile(graph, 'src/auth.ts', { maxTokens: 10000 });
      expect(result).not.toBeNull();
      expect(result!.files).toContain('src/auth.ts');
    });

    it('should return null for unknown file', () => {
      const result = getContextForFile(graph, 'nope.ts', { maxTokens: 10000 });
      expect(result).toBeNull();
    });
  });
});
