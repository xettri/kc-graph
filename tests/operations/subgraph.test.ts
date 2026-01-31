import { describe, it, expect } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { extractSubgraph, getFileStructure } from '../../src/operations/subgraph.js';

function buildGraph(): CodeGraph {
  const g = new CodeGraph();

  g.addNode({
    id: 'f1',
    type: 'file',
    name: 'app.ts',
    qualifiedName: 'app.ts',
    content: '',
    signature: '',
    location: { file: 'app.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
    metadata: {},
  });
  g.addNode({
    id: 'f1#A',
    type: 'class',
    name: 'A',
    qualifiedName: 'app.ts#A',
    content: 'class A {}',
    signature: 'class A',
    location: { file: 'app.ts', startLine: 2, endLine: 10, startColumn: 0, endColumn: 1 },
    metadata: {},
  });
  g.addNode({
    id: 'f1#A.run',
    type: 'function',
    name: 'run',
    qualifiedName: 'app.ts#A.run',
    content: 'run() {}',
    signature: '() => void',
    location: { file: 'app.ts', startLine: 3, endLine: 5, startColumn: 2, endColumn: 3 },
    metadata: {},
  });
  g.addNode({
    id: 'f1#helper',
    type: 'function',
    name: 'helper',
    qualifiedName: 'app.ts#helper',
    content: 'function helper() {}',
    signature: '() => void',
    location: { file: 'app.ts', startLine: 12, endLine: 14, startColumn: 0, endColumn: 1 },
    metadata: {},
  });
  g.addNode({
    id: 'f2',
    type: 'file',
    name: 'utils.ts',
    qualifiedName: 'utils.ts',
    content: '',
    signature: '',
    location: { file: 'utils.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
    metadata: {},
  });
  g.addNode({
    id: 'f2#format',
    type: 'function',
    name: 'format',
    qualifiedName: 'utils.ts#format',
    content: 'function format() {}',
    signature: '() => string',
    location: { file: 'utils.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 1 },
    metadata: {},
  });

  g.addEdge({ source: 'f1', target: 'f1#A', type: 'contains', weight: 1, metadata: {} });
  g.addEdge({ source: 'f1#A', target: 'f1#A.run', type: 'contains', weight: 1, metadata: {} });
  g.addEdge({ source: 'f1', target: 'f1#helper', type: 'contains', weight: 1, metadata: {} });
  g.addEdge({ source: 'f1#A.run', target: 'f2#format', type: 'calls', weight: 1, metadata: {} });
  g.addEdge({ source: 'f1#helper', target: 'f1#A.run', type: 'calls', weight: 1, metadata: {} });

  return g;
}

describe('Subgraph', () => {
  describe('extractSubgraph', () => {
    it('should extract a neighborhood around a seed node', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, ['f1#A.run'], { maxDepth: 1 });

      expect(sub.nodeCount).toBeGreaterThan(0);
      expect(sub.hasNode('f1#A.run')).toBe(true);
    });

    it('should include outbound neighbors', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, ['f1#A.run'], { maxDepth: 1, direction: 'outbound' });

      // A.run calls format
      expect(sub.hasNode('f2#format')).toBe(true);
    });

    it('should include inbound neighbors', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, ['f1#A.run'], { maxDepth: 1, direction: 'inbound' });

      // helper calls A.run, A contains A.run
      expect(sub.hasNode('f1#helper')).toBe(true);
    });

    it('should respect maxDepth', () => {
      const g = buildGraph();
      const sub1 = extractSubgraph(g, ['f1'], { maxDepth: 1 });
      const sub2 = extractSubgraph(g, ['f1'], { maxDepth: 3 });

      expect(sub2.nodeCount).toBeGreaterThanOrEqual(sub1.nodeCount);
    });

    it('should filter by node types', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, ['f1'], { maxDepth: 3, nodeTypes: ['function'] });

      const nodes = [...sub.allNodes()];
      expect(nodes.every((n) => n.type === 'function')).toBe(true);
    });

    it('should filter by edge types', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, ['f1'], { maxDepth: 3, edgeTypes: ['contains'] });

      // Should include contained nodes but not follow 'calls' edges
      expect(sub.hasNode('f1#A')).toBe(true);
      // format is only reachable via 'calls', not 'contains'
      expect(sub.hasNode('f2#format')).toBe(false);
    });

    it('should preserve edges between included nodes', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, ['f1'], { maxDepth: 3 });

      expect(sub.edgeCount).toBeGreaterThan(0);
    });

    it('should handle empty seed list', () => {
      const g = buildGraph();
      const sub = extractSubgraph(g, []);
      expect(sub.nodeCount).toBe(0);
    });
  });

  describe('getFileStructure', () => {
    it('should return containment tree for a file', () => {
      const g = buildGraph();
      const structure = getFileStructure(g, 'app.ts');

      expect(structure.size).toBeGreaterThan(0);
      // File node should contain A and helper
      const fileChildren = structure.get('f1');
      expect(fileChildren).toBeDefined();
      expect(fileChildren!.some((n) => n.name === 'A')).toBe(true);
      expect(fileChildren!.some((n) => n.name === 'helper')).toBe(true);
    });

    it('should return empty map for non-existent file', () => {
      const g = buildGraph();
      const structure = getFileStructure(g, 'nonexistent.ts');
      expect(structure.size).toBe(0);
    });
  });
});
