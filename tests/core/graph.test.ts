import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { resetNodeCounter } from '../../src/core/node.js';
import { resetEdgeCounter } from '../../src/core/edge.js';
import type { CodeNode } from '../../src/core/types.js';

describe('CodeGraph', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();
    resetNodeCounter();
    resetEdgeCounter();
  });

  // ---------------------------------------------------------------------------
  // Node CRUD
  // ---------------------------------------------------------------------------

  describe('Node CRUD', () => {
    it('should add a node and retrieve it', () => {
      const node = graph.addNode({
        type: 'function',
        name: 'handleLogin',
        qualifiedName: 'src/auth.ts#handleLogin',
        content: 'function handleLogin() {}',
        signature: 'function handleLogin(): void',
        location: { file: 'src/auth.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 1 },
      });

      expect(node.id).toBe('src/auth.ts#handleLogin');
      expect(node.type).toBe('function');
      expect(node.name).toBe('handleLogin');
      expect(graph.nodeCount).toBe(1);

      const retrieved = graph.getNode(node.id);
      expect(retrieved).toBe(node);
    });

    it('should return existing node on duplicate ID', () => {
      const first = graph.addNode({ type: 'function', name: 'foo', qualifiedName: 'foo' });
      const second = graph.addNode({ type: 'function', name: 'bar', qualifiedName: 'foo' });
      expect(second.id).toBe(first.id);
      expect(second.name).toBe('foo');
      expect(graph.nodeCount).toBe(1);
    });

    it('should remove a node and its edges', () => {
      const n1 = graph.addNode({ type: 'function', name: 'a', qualifiedName: 'a' });
      const n2 = graph.addNode({ type: 'function', name: 'b', qualifiedName: 'b' });
      graph.addEdge({ source: n1.id, target: n2.id, type: 'calls' });

      expect(graph.edgeCount).toBe(1);
      graph.removeNode(n1.id);

      expect(graph.nodeCount).toBe(1);
      expect(graph.edgeCount).toBe(0);
      expect(graph.hasNode(n1.id)).toBe(false);
    });

    it('should update a node', () => {
      const node = graph.addNode({ type: 'function', name: 'foo', qualifiedName: 'foo' });
      const updated = graph.updateNode(node.id, { content: 'new content' });

      expect(updated.content).toBe('new content');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(node.createdAt);
    });

    it('should throw when updating non-existent node', () => {
      expect(() => graph.updateNode('nope', {})).toThrow('Node not found: nope');
    });

    it('should auto-generate IDs when no qualifiedName provided', () => {
      const node = graph.addNode({ type: 'variable', name: 'x' });
      expect(node.id).toMatch(/^node_\d+_/);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge CRUD
  // ---------------------------------------------------------------------------

  describe('Edge CRUD', () => {
    let n1: CodeNode;
    let n2: CodeNode;

    beforeEach(() => {
      n1 = graph.addNode({ type: 'function', name: 'a', qualifiedName: 'a' });
      n2 = graph.addNode({ type: 'function', name: 'b', qualifiedName: 'b' });
    });

    it('should add an edge between existing nodes', () => {
      const edge = graph.addEdge({ source: n1.id, target: n2.id, type: 'calls' });
      expect(edge.source).toBe(n1.id);
      expect(edge.target).toBe(n2.id);
      expect(edge.type).toBe('calls');
      expect(edge.weight).toBe(1.0);
      expect(graph.edgeCount).toBe(1);
    });

    it('should reject edges to non-existent nodes', () => {
      expect(() => graph.addEdge({ source: 'nope', target: n2.id, type: 'calls' })).toThrow(
        'Source node not found: nope',
      );
      expect(() => graph.addEdge({ source: n1.id, target: 'nope', type: 'calls' })).toThrow(
        'Target node not found: nope',
      );
    });

    it('should remove an edge', () => {
      const edge = graph.addEdge({ source: n1.id, target: n2.id, type: 'calls' });
      expect(graph.removeEdge(edge.id)).toBe(true);
      expect(graph.edgeCount).toBe(0);
    });

    it('should support custom edge weights', () => {
      const edge = graph.addEdge({ source: n1.id, target: n2.id, type: 'calls', weight: 0.5 });
      expect(edge.weight).toBe(0.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Neighbors & Connections
  // ---------------------------------------------------------------------------

  describe('Neighbors', () => {
    it('should get successors and predecessors', () => {
      const a = graph.addNode({ type: 'function', name: 'a', qualifiedName: 'a' });
      const b = graph.addNode({ type: 'function', name: 'b', qualifiedName: 'b' });
      const c = graph.addNode({ type: 'function', name: 'c', qualifiedName: 'c' });

      graph.addEdge({ source: a.id, target: b.id, type: 'calls' });
      graph.addEdge({ source: a.id, target: c.id, type: 'calls' });

      expect(graph.getSuccessors(a.id).map((n) => n.name)).toEqual(['b', 'c']);
      expect(graph.getPredecessors(b.id).map((n) => n.name)).toEqual(['a']);
      expect(
        graph
          .getNeighbors(b.id)
          .map((n) => n.name)
          .sort(),
      ).toEqual(['a']);
    });

    it('should filter edges by type', () => {
      const a = graph.addNode({ type: 'file', name: 'f', qualifiedName: 'f' });
      const b = graph.addNode({ type: 'function', name: 'fn', qualifiedName: 'fn' });
      const c = graph.addNode({ type: 'variable', name: 'v', qualifiedName: 'v' });

      graph.addEdge({ source: a.id, target: b.id, type: 'contains' });
      graph.addEdge({ source: b.id, target: c.id, type: 'references' });

      expect(graph.getOutEdges(a.id, ['contains']).length).toBe(1);
      expect(graph.getOutEdges(a.id, ['calls']).length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Search & Filter
  // ---------------------------------------------------------------------------

  describe('Search & Filter', () => {
    beforeEach(() => {
      graph.addNode({
        type: 'function',
        name: 'handleLogin',
        qualifiedName: 'src/auth.ts#handleLogin',
        location: { file: 'src/auth.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
      });
      graph.addNode({
        type: 'function',
        name: 'handleLogout',
        qualifiedName: 'src/auth.ts#handleLogout',
        location: { file: 'src/auth.ts', startLine: 12, endLine: 20, startColumn: 0, endColumn: 0 },
      });
      graph.addNode({
        type: 'class',
        name: 'UserService',
        qualifiedName: 'src/user.ts#UserService',
        location: { file: 'src/user.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
      });
    });

    it('should find by name (case-insensitive)', () => {
      expect(graph.findByName('handlelogin').length).toBe(1);
      expect(graph.findByName('HANDLELOGIN').length).toBe(1);
    });

    it('should find by file', () => {
      expect(graph.findByFile('src/auth.ts').length).toBe(2);
      expect(graph.findByFile('src/user.ts').length).toBe(1);
    });

    it('should find by type', () => {
      expect(graph.findByType('function').length).toBe(2);
      expect(graph.findByType('class').length).toBe(1);
    });

    it('should find by filter with regex name', () => {
      const results = graph.findNodes({ name: /^handle/ });
      expect(results.length).toBe(2);
    });

    it('should find by combined filter', () => {
      const results = graph.findNodes({ type: 'function', file: 'src/auth.ts' });
      expect(results.length).toBe(2);
    });

    it('should resolve identifiers', () => {
      const node = graph.resolve('handleLogin');
      expect(node?.name).toBe('handleLogin');

      const byQualified = graph.resolve('src/auth.ts#handleLogin');
      expect(byQualified?.name).toBe('handleLogin');
    });
  });

  // ---------------------------------------------------------------------------
  // Bulk Operations
  // ---------------------------------------------------------------------------

  describe('Bulk Operations', () => {
    it('should remove all nodes for a file', () => {
      graph.addNode({
        type: 'function',
        name: 'a',
        qualifiedName: 'file.ts#a',
        location: { file: 'file.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
      });
      graph.addNode({
        type: 'function',
        name: 'b',
        qualifiedName: 'file.ts#b',
        location: { file: 'file.ts', startLine: 6, endLine: 10, startColumn: 0, endColumn: 0 },
      });
      graph.addNode({
        type: 'function',
        name: 'c',
        qualifiedName: 'other.ts#c',
        location: { file: 'other.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
      });

      const removed = graph.removeFile('file.ts');
      expect(removed).toBe(2);
      expect(graph.nodeCount).toBe(1);
    });

    it('should clear the entire graph', () => {
      graph.addNode({ type: 'function', name: 'a', qualifiedName: 'a' });
      graph.addNode({ type: 'function', name: 'b', qualifiedName: 'b' });
      graph.clear();
      expect(graph.nodeCount).toBe(0);
      expect(graph.edgeCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Iterators
  // ---------------------------------------------------------------------------

  describe('Iterators', () => {
    it('should iterate all nodes', () => {
      graph.addNode({ type: 'function', name: 'a', qualifiedName: 'a' });
      graph.addNode({ type: 'function', name: 'b', qualifiedName: 'b' });

      const names: string[] = [];
      for (const node of graph.allNodes()) {
        names.push(node.name);
      }
      expect(names.sort()).toEqual(['a', 'b']);
    });

    it('should iterate all edges', () => {
      const a = graph.addNode({ type: 'function', name: 'a', qualifiedName: 'a' });
      const b = graph.addNode({ type: 'function', name: 'b', qualifiedName: 'b' });
      graph.addEdge({ source: a.id, target: b.id, type: 'calls' });

      const types: string[] = [];
      for (const edge of graph.allEdges()) {
        types.push(edge.type);
      }
      expect(types).toEqual(['calls']);
    });
  });
});
