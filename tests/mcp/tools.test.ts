import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { createToolHandlers, singleProject } from '../../src/mcp/tools.js';
import type { ProjectMap } from '../../src/mcp/tools.js';

function buildGraph(): CodeGraph {
  const g = new CodeGraph();

  g.addNode({
    id: 'src/app.ts',
    type: 'file',
    name: 'app.ts',
    qualifiedName: 'src/app.ts',
    content: '',
    signature: '',
    location: { file: 'src/app.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
    metadata: {},
  });
  g.addNode({
    id: 'src/app.ts#main',
    type: 'function',
    name: 'main',
    qualifiedName: 'src/app.ts#main',
    content: 'function main() {}',
    signature: '() => void',
    location: { file: 'src/app.ts', startLine: 2, endLine: 5, startColumn: 0, endColumn: 1 },
    metadata: {},
  });
  g.addNode({
    id: 'src/app.ts#helper',
    type: 'function',
    name: 'helper',
    qualifiedName: 'src/app.ts#helper',
    content: 'function helper() {}',
    signature: '() => string',
    location: { file: 'src/app.ts', startLine: 7, endLine: 9, startColumn: 0, endColumn: 1 },
    metadata: {},
  });
  g.addNode({
    id: 'src/app.ts#Config',
    type: 'type',
    name: 'Config',
    qualifiedName: 'src/app.ts#Config',
    content: 'interface Config {}',
    signature: 'interface Config',
    location: { file: 'src/app.ts', startLine: 11, endLine: 13, startColumn: 0, endColumn: 1 },
    metadata: {},
  });
  g.addNode({
    id: 'src/utils.ts',
    type: 'file',
    name: 'utils.ts',
    qualifiedName: 'src/utils.ts',
    content: '',
    signature: '',
    location: { file: 'src/utils.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
    metadata: {},
  });
  g.addNode({
    id: 'src/utils.ts#format',
    type: 'function',
    name: 'format',
    qualifiedName: 'src/utils.ts#format',
    content: 'function format() {}',
    signature: '(s: string) => string',
    location: { file: 'src/utils.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 1 },
    metadata: {},
  });

  g.addEdge({
    source: 'src/app.ts',
    target: 'src/app.ts#main',
    type: 'contains',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/app.ts',
    target: 'src/app.ts#helper',
    type: 'contains',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/app.ts#main',
    target: 'src/app.ts#helper',
    type: 'calls',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/app.ts#main',
    target: 'src/utils.ts#format',
    type: 'calls',
    weight: 1,
    metadata: {},
  });

  return g;
}

function buildSecondGraph(): CodeGraph {
  const g = new CodeGraph();

  g.addNode({
    id: 'lib/auth.ts',
    type: 'file',
    name: 'auth.ts',
    qualifiedName: 'lib/auth.ts',
    content: '',
    signature: '',
    location: { file: 'lib/auth.ts', startLine: 1, endLine: 30, startColumn: 0, endColumn: 0 },
    metadata: {},
  });
  g.addNode({
    id: 'lib/auth.ts#login',
    type: 'function',
    name: 'login',
    qualifiedName: 'lib/auth.ts#login',
    content: 'function login() {}',
    signature: '(user: string) => boolean',
    location: { file: 'lib/auth.ts', startLine: 2, endLine: 10, startColumn: 0, endColumn: 1 },
    metadata: {},
  });
  g.addNode({
    id: 'lib/auth.ts#logout',
    type: 'function',
    name: 'logout',
    qualifiedName: 'lib/auth.ts#logout',
    content: 'function logout() {}',
    signature: '() => void',
    location: { file: 'lib/auth.ts', startLine: 12, endLine: 15, startColumn: 0, endColumn: 1 },
    metadata: {},
  });

  g.addEdge({
    source: 'lib/auth.ts',
    target: 'lib/auth.ts#login',
    type: 'contains',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'lib/auth.ts',
    target: 'lib/auth.ts#logout',
    type: 'contains',
    weight: 1,
    metadata: {},
  });

  return g;
}

describe('MCP Tools', () => {
  let graph: CodeGraph;
  let handlers: ReturnType<typeof createToolHandlers>;

  beforeEach(() => {
    graph = buildGraph();
    handlers = createToolHandlers(singleProject('my-app', graph, '/tmp/my-app'));
  });

  describe('list_projects', () => {
    it('should list single project', () => {
      const result = handlers['list_projects']!({});
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('my-app');
      expect(data[0].nodes).toBe(6);
      expect(data[0].edges).toBe(4);
    });
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
      expect(data[0].name).toBe('helper');
    });
  });
});

describe('MCP Tools — Multi-project', () => {
  let projects: ProjectMap;
  let handlers: ReturnType<typeof createToolHandlers>;

  beforeEach(() => {
    projects = new Map([
      ['my-app', { graph: buildGraph(), path: '/tmp/my-app' }],
      ['auth-service', { graph: buildSecondGraph(), path: '/tmp/auth-service' }],
    ]);
    handlers = createToolHandlers(projects);
  });

  describe('list_projects', () => {
    it('should list all projects', () => {
      const result = handlers['list_projects']!({});
      const data = JSON.parse(result.content[0]!.text);
      expect(data).toHaveLength(2);
      const names = data.map((p: { name: string }) => p.name);
      expect(names).toContain('my-app');
      expect(names).toContain('auth-service');
    });
  });

  describe('search_code', () => {
    it('should search across all projects', () => {
      const result = handlers['search_code']!({ query: 'login' });
      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBe(1);
      expect(data[0].name).toBe('login');
      expect(data[0].project).toBe('auth-service');
    });

    it('should include project field in multi-project results', () => {
      const result = handlers['search_code']!({ query: 'main' });
      const data = JSON.parse(result.content[0]!.text);
      expect(data[0].project).toBe('my-app');
    });

    it('should filter by project', () => {
      const result = handlers['search_code']!({ query: 'main', project: 'auth-service' });
      const data = JSON.parse(result.content[0]!.text);
      expect(data.length).toBe(0);
    });

    it('should error for unknown project', () => {
      const result = handlers['search_code']!({ query: 'main', project: 'nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('get_context', () => {
    it('should find symbol across projects', () => {
      const result = handlers['get_context']!({ symbol: 'login' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('auth-service');
    });

    it('should scope to specific project', () => {
      const result = handlers['get_context']!({ symbol: 'main', project: 'my-app' });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('get_impact', () => {
    it('should find symbol in correct project', () => {
      const result = handlers['get_impact']!({ symbol: 'login' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('auth-service');
    });
  });

  describe('get_structure', () => {
    it('should find file in correct project', () => {
      const result = handlers['get_structure']!({ path: 'lib/auth.ts' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text);
      expect(data.some((s: { name: string }) => s.name === 'login')).toBe(true);
    });
  });
});
