import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { bfs, dfs, kHopNeighborhood } from '../../src/operations/traversal.js';

describe('Traversal', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();

    // Build a simple graph:
    //   A → B → D
    //   A → C → D
    //   D → E
    graph.addNode({ type: 'function', name: 'A', qualifiedName: 'A' });
    graph.addNode({ type: 'function', name: 'B', qualifiedName: 'B' });
    graph.addNode({ type: 'function', name: 'C', qualifiedName: 'C' });
    graph.addNode({ type: 'function', name: 'D', qualifiedName: 'D' });
    graph.addNode({ type: 'function', name: 'E', qualifiedName: 'E' });

    graph.addEdge({ source: 'A', target: 'B', type: 'calls' });
    graph.addEdge({ source: 'A', target: 'C', type: 'calls' });
    graph.addEdge({ source: 'B', target: 'D', type: 'calls' });
    graph.addEdge({ source: 'C', target: 'D', type: 'calls' });
    graph.addEdge({ source: 'D', target: 'E', type: 'calls' });
  });

  describe('BFS', () => {
    it('should traverse in breadth-first order', () => {
      const names: string[] = [];
      for (const { node } of bfs(graph, 'A')) {
        names.push(node.name);
      }
      expect(names[0]).toBe('A');
      // B and C should come before D and E
      expect(names.indexOf('B')).toBeLessThan(names.indexOf('D'));
      expect(names.indexOf('C')).toBeLessThan(names.indexOf('D'));
      expect(names.indexOf('D')).toBeLessThan(names.indexOf('E'));
    });

    it('should respect maxDepth', () => {
      const names: string[] = [];
      for (const { node } of bfs(graph, 'A', { maxDepth: 1 })) {
        names.push(node.name);
      }
      expect(names.sort()).toEqual(['A', 'B', 'C']);
    });

    it('should traverse inbound edges', () => {
      const names: string[] = [];
      for (const { node } of bfs(graph, 'D', { direction: 'inbound' })) {
        names.push(node.name);
      }
      expect(names).toContain('D');
      expect(names).toContain('B');
      expect(names).toContain('C');
      expect(names).toContain('A');
    });

    it('should filter by edge type', () => {
      // Add a different edge type
      graph.addEdge({ source: 'A', target: 'E', type: 'imports' });

      const names: string[] = [];
      for (const { node } of bfs(graph, 'A', { edgeTypes: ['imports'] })) {
        names.push(node.name);
      }
      expect(names).toEqual(['A', 'E']);
    });

    it('should track depth correctly', () => {
      const depths = new Map<string, number>();
      for (const { node, depth } of bfs(graph, 'A')) {
        depths.set(node.name, depth);
      }
      expect(depths.get('A')).toBe(0);
      expect(depths.get('B')).toBe(1);
      expect(depths.get('C')).toBe(1);
      expect(depths.get('D')).toBe(2);
      expect(depths.get('E')).toBe(3);
    });
  });

  describe('DFS', () => {
    it('should traverse in depth-first order', () => {
      const names: string[] = [];
      for (const { node } of dfs(graph, 'A')) {
        names.push(node.name);
      }
      expect(names[0]).toBe('A');
      expect(names.length).toBe(5); // All nodes visited
    });

    it('should respect maxDepth', () => {
      const names: string[] = [];
      for (const { node } of dfs(graph, 'A', { maxDepth: 1 })) {
        names.push(node.name);
      }
      expect(names.sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('kHopNeighborhood', () => {
    it('should collect nodes within k hops', () => {
      const nodes = kHopNeighborhood(graph, ['A'], 1);
      expect(nodes.map((n) => n.name).sort()).toEqual(['A', 'B', 'C']);
    });

    it('should support multiple seeds', () => {
      const nodes = kHopNeighborhood(graph, ['B', 'C'], 1);
      const names = nodes.map((n) => n.name).sort();
      expect(names).toContain('A');
      expect(names).toContain('B');
      expect(names).toContain('C');
      expect(names).toContain('D');
    });
  });
});
