import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { cosineSimilarity, findSimilar, setEmbedding } from '../../src/ai/embeddings.js';

describe('Embeddings', () => {
  describe('cosineSimilarity', () => {
    it('should compute similarity of identical vectors as 1.0', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const b = new Float32Array([1, 0, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it('should compute similarity of orthogonal vectors as 0.0', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const b = new Float32Array([0, 1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('should compute similarity of opposite vectors as -1.0', () => {
      const a = new Float32Array([1, 0, 0, 0]);
      const b = new Float32Array([-1, 0, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it('should handle arbitrary vectors', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([4, 5, 6]);
      // dot = 4+10+18 = 32, normA = sqrt(14), normB = sqrt(77)
      const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
      expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
    });

    it('should handle zero vectors', () => {
      const a = new Float32Array([0, 0, 0]);
      const b = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('should throw on length mismatch', () => {
      const a = new Float32Array([1, 2]);
      const b = new Float32Array([1, 2, 3]);
      expect(() => cosineSimilarity(a, b)).toThrow('Vector length mismatch');
    });

    it('should handle vectors with length not divisible by 4 (loop remainder)', () => {
      const a = new Float32Array([1, 2, 3, 4, 5]);
      const b = new Float32Array([5, 4, 3, 2, 1]);
      const dot = 5 + 8 + 9 + 8 + 5;
      const normA = Math.sqrt(1 + 4 + 9 + 16 + 25);
      const normB = Math.sqrt(25 + 16 + 9 + 4 + 1);
      expect(cosineSimilarity(a, b)).toBeCloseTo(dot / (normA * normB));
    });
  });

  describe('findSimilar', () => {
    let graph: CodeGraph;

    beforeEach(() => {
      graph = new CodeGraph();

      graph.addNode({
        type: 'function',
        name: 'login',
        qualifiedName: 'login',
        embedding: new Float32Array([1, 0, 0, 0]),
      });
      graph.addNode({
        type: 'function',
        name: 'authenticate',
        qualifiedName: 'authenticate',
        embedding: new Float32Array([0.9, 0.1, 0, 0]),
      });
      graph.addNode({
        type: 'function',
        name: 'render',
        qualifiedName: 'render',
        embedding: new Float32Array([0, 0, 1, 0]),
      });
      graph.addNode({
        type: 'function',
        name: 'noEmbedding',
        qualifiedName: 'noEmbedding',
      });
    });

    it('should find similar nodes sorted by score', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = findSimilar(graph, query, 3);

      expect(results.length).toBe(3);
      expect(results[0]!.node.name).toBe('login');
      expect(results[0]!.score).toBeCloseTo(1.0);
      expect(results[1]!.node.name).toBe('authenticate');
    });

    it('should respect k limit', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = findSimilar(graph, query, 1);
      expect(results.length).toBe(1);
    });

    it('should respect threshold', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = findSimilar(graph, query, 10, 0.5);
      expect(results.length).toBe(2); // login and authenticate
    });

    it('should skip nodes without embeddings', () => {
      const query = new Float32Array([1, 0, 0, 0]);
      const results = findSimilar(graph, query, 10);
      expect(results.every((r) => r.node.name !== 'noEmbedding')).toBe(true);
    });
  });

  describe('setEmbedding', () => {
    it('should set embedding on a node by name', () => {
      const graph = new CodeGraph();
      graph.addNode({ type: 'function', name: 'foo', qualifiedName: 'foo' });

      const emb = new Float32Array([1, 2, 3]);
      const success = setEmbedding(graph, 'foo', emb);
      expect(success).toBe(true);

      const node = graph.getNode('foo');
      expect(node?.embedding).toBe(emb);
    });

    it('should return false for non-existent node', () => {
      const graph = new CodeGraph();
      const success = setEmbedding(graph, 'nope', new Float32Array([1]));
      expect(success).toBe(false);
    });
  });
});
