import { describe, it, expect } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import {
  exportToJSON,
  importFromJSON,
  toJSONString,
  fromJSONString,
} from '../../src/serialization/json.js';

describe('JSON Serialization', () => {
  function buildTestGraph(): CodeGraph {
    const graph = new CodeGraph();

    graph.addNode({
      type: 'function',
      name: 'login',
      qualifiedName: 'auth.ts#login',
      content: 'function login() {}',
      signature: 'function login(): void',
      location: { file: 'auth.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
      embedding: new Float32Array([1.0, 2.0, 3.0, 4.0]),
    });

    graph.addNode({
      type: 'function',
      name: 'validate',
      qualifiedName: 'auth.ts#validate',
      content: 'function validate() {}',
      signature: 'function validate(): boolean',
      location: { file: 'auth.ts', startLine: 5, endLine: 7, startColumn: 0, endColumn: 0 },
    });

    graph.addEdge({
      source: 'auth.ts#login',
      target: 'auth.ts#validate',
      type: 'calls',
      weight: 0.8,
    });

    return graph;
  }

  describe('exportToJSON / importFromJSON', () => {
    it('should round-trip nodes and edges', () => {
      const original = buildTestGraph();
      const snapshot = exportToJSON(original);
      const restored = importFromJSON(snapshot);

      expect(restored.nodeCount).toBe(original.nodeCount);
      expect(restored.edgeCount).toBe(original.edgeCount);
    });

    it('should preserve node data', () => {
      const original = buildTestGraph();
      const snapshot = exportToJSON(original);
      const restored = importFromJSON(snapshot);

      const node = restored.getNode('auth.ts#login');
      expect(node).toBeDefined();
      expect(node!.name).toBe('login');
      expect(node!.type).toBe('function');
      expect(node!.content).toBe('function login() {}');
      expect(node!.signature).toBe('function login(): void');
      expect(node!.location?.file).toBe('auth.ts');
    });

    it('should preserve embeddings', () => {
      const original = buildTestGraph();
      const snapshot = exportToJSON(original);
      const restored = importFromJSON(snapshot);

      const node = restored.getNode('auth.ts#login');
      expect(node!.embedding).toBeInstanceOf(Float32Array);
      expect(node!.embedding!.length).toBe(4);
      expect(node!.embedding![0]).toBeCloseTo(1.0);
      expect(node!.embedding![3]).toBeCloseTo(4.0);
    });

    it('should handle null embeddings', () => {
      const original = buildTestGraph();
      const snapshot = exportToJSON(original);
      const restored = importFromJSON(snapshot);

      const node = restored.getNode('auth.ts#validate');
      expect(node!.embedding).toBeNull();
    });

    it('should preserve edge data', () => {
      const original = buildTestGraph();
      const snapshot = exportToJSON(original);
      const restored = importFromJSON(snapshot);

      const edges = restored.getOutEdges('auth.ts#login');
      expect(edges.length).toBe(1);
      expect(edges[0]!.target).toBe('auth.ts#validate');
      expect(edges[0]!.type).toBe('calls');
      expect(edges[0]!.weight).toBe(0.8);
    });

    it('should include metadata in snapshot', () => {
      const graph = buildTestGraph();
      const snapshot = exportToJSON(graph);
      expect(snapshot.version).toBe('1.0');
      expect(snapshot.metadata.nodeCount).toBe(2);
      expect(snapshot.metadata.edgeCount).toBe(1);
    });
  });

  describe('toJSONString / fromJSONString', () => {
    it('should round-trip via string', () => {
      const original = buildTestGraph();
      const json = toJSONString(original);
      const restored = fromJSONString(json);

      expect(restored.nodeCount).toBe(original.nodeCount);
      expect(restored.edgeCount).toBe(original.edgeCount);

      const node = restored.getNode('auth.ts#login');
      expect(node!.embedding![0]).toBeCloseTo(1.0);
    });

    it('should produce pretty JSON when requested', () => {
      const graph = buildTestGraph();
      const json = toJSONString(graph, true);
      expect(json).toContain('\n');
      expect(json).toContain('  ');
    });
  });
});
