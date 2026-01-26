import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { createToolHandlers } from '../../src/mcp/tools.js';

function buildGraph(): CodeGraph {
  const g = new CodeGraph();

  g.addNode({ id: 'src/app.ts', type: 'file', name: 'app.ts', qualifiedName: 'src/app.ts', content: '', signature: '', location: { file: 'src/app.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 }, metadata: {} });
  g.addNode({ id: 'src/app.ts#main', type: 'function', name: 'main', qualifiedName: 'src/app.ts#main', content: 'function main() {}', signature: '() => void', location: { file: 'src/app.ts', startLine: 2, endLine: 5, startColumn: 0, endColumn: 1 }, metadata: {} });
  g.addNode({ id: 'src/app.ts#helper', type: 'function', name: 'helper', qualifiedName: 'src/app.ts#helper', content: 'function helper() {}', signature: '() => string', location: { file: 'src/app.ts', startLine: 7, endLine: 9, startColumn: 0, endColumn: 1 }, metadata: {} });
  g.addNode({ id: 'src/app.ts#Config', type: 'type', name: 'Config', qualifiedName: 'src/app.ts#Config', content: 'interface Config {}', signature: 'interface Config', location: { file: 'src/app.ts', startLine: 11, endLine: 13, startColumn: 0, endColumn: 1 }, metadata: {} });
  g.addNode({ id: 'src/utils.ts', type: 'file', name: 'utils.ts', qualifiedName: 'src/utils.ts', content: '', signature: '', location: { file: 'src/utils.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 }, metadata: {} });
  g.addNode({ id: 'src/utils.ts#format', type: 'function', name: 'format', qualifiedName: 'src/utils.ts#format', content: 'function format() {}', signature: '(s: string) => string', location: { file: 'src/utils.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 1 }, metadata: {} });

  g.addEdge({ source: 'src/app.ts', target: 'src/app.ts#main', type: 'contains', weight: 1, metadata: {} });
  g.addEdge({ source: 'src/app.ts', target: 'src/app.ts#helper', type: 'contains', weight: 1, metadata: {} });
  g.addEdge({ source: 'src/app.ts#main', target: 'src/app.ts#helper', type: 'calls', weight: 1, metadata: {} });
  g.addEdge({ source: 'src/app.ts#main', target: 'src/utils.ts#format', type: 'calls', weight: 1, metadata: {} });

  return g;
}

describe('MCP Tools', () => {
  let graph: CodeGraph;
  let handlers: ReturnType<typeof createToolHandlers>;

  beforeEach(() => {
    graph = buildGraph();
    handlers = createToolHandlers(graph);
  });

  describe('search_code', () => {
    it('should find symbols by name', () => {
      const result = handlers['search_code']!({ query: 'main' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.some((r: { name: string }) => r.name === 'main')).toBe(true);
    });

    it('should filter by type', () => {
      const result = handlers['search_code']!({ query: 'main', type: 'function' });
      const data = JSON.parse(result.content[0]!.text);
      expect(data.every((r: { type: string }) => r.type === 'function')).toBe(true);
    });

    it('should filter by file', () => {
      const result = handlers['search_code']!({ query: 'format', file: 'src/utils.ts' });
      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBe(1);
      expect(data[0].file).toBe('src/utils.ts');
    });

    it('should return empty for non-existent symbol', () => {
      const result = handlers['search_code']!({ query: 'nonexistent' });
      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBe(0);
    });

    it('should handle special regex characters in query', () => {
      const result = handlers['search_code']!({ query: 'main()' });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('get_context', () => {
    it('should return context for a symbol', () => {
      const result = handlers['get_context']!({ symbol: 'main' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text.length).toBeGreaterThan(0);
    });

    it('should return context for a file', () => {
      const result = handlers['get_context']!({ file: 'src/app.ts' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text.length).toBeGreaterThan(0);
    });

    it('should error when neither symbol nor file provided', () => {
      const result = handlers['get_context']!({});
      expect(result.isError).toBe(true);
    });

    it('should error for non-existent symbol', () => {
      const result = handlers['get_context']!({ symbol: 'doesNotExist' });
      expect(result.isError).toBe(true);
    });
  });

  describe('get_impact', () => {
    it('should return impact analysis for a symbol', () => {
      const result = handlers['get_impact']!({ symbol: 'helper' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text.length).toBeGreaterThan(0);
    });

    it('should error for non-existent symbol', () => {
      const result = handlers['get_impact']!({ symbol: 'doesNotExist' });
      expect(result.isError).toBe(true);
    });

    it('should accept maxDepth parameter', () => {
      const result = handlers['get_impact']!({ symbol: 'helper', maxDepth: 1 });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('get_structure', () => {
    it('should return file structure', () => {
      const result = handlers['get_structure']!({ path: 'src/app.ts' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBeGreaterThan(0);
      expect(data.some((s: { name: string }) => s.name === 'main')).toBe(true);
    });

    it('should error for non-existent file', () => {
      const result = handlers['get_structure']!({ path: 'nonexistent.ts' });
      expect(result.isError).toBe(true);
    });
  });

  describe('find_similar', () => {
    it('should error when no embedding available', () => {
      const result = handlers['find_similar']!({ symbol: 'main' });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('No embedding');
    });

    it('should error for non-existent symbol', () => {
      const result = handlers['find_similar']!({ symbol: 'doesNotExist' });
      expect(result.isError).toBe(true);
    });

    it('should find similar with embeddings', () => {
      // Add embeddings
      const mainNode = graph.getNode('src/app.ts#main')!;
      mainNode.embedding = new Float32Array([1, 0, 0, 0]);
      const helperNode = graph.getNode('src/app.ts#helper')!;
      helperNode.embedding = new Float32Array([0.9, 0.1, 0, 0]);
      const formatNode = graph.getNode('src/utils.ts#format')!;
      formatNode.embedding = new Float32Array([0, 1, 0, 0]);

      const result = handlers['find_similar']!({ symbol: 'main' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBeGreaterThan(0);
      // helper should be more similar to main than format
      expect(data[0].name).toBe('helper');
    });
  });
});
