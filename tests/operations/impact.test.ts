import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { analyzeImpact, formatImpactSummary } from '../../src/operations/impact.js';

describe('Impact Analysis', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();

    // Build a dependency chain:
    //   utils.ts#validate → auth.ts#login → api.ts#handleRequest → router.ts#route
    graph.addNode({
      type: 'function',
      name: 'validate',
      qualifiedName: 'utils.ts#validate',
      location: { file: 'utils.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'login',
      qualifiedName: 'auth.ts#login',
      location: { file: 'auth.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'handleRequest',
      qualifiedName: 'api.ts#handleRequest',
      location: { file: 'api.ts', startLine: 1, endLine: 30, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'route',
      qualifiedName: 'router.ts#route',
      location: { file: 'router.ts', startLine: 1, endLine: 15, startColumn: 0, endColumn: 0 },
    });

    // login calls validate
    graph.addEdge({ source: 'auth.ts#login', target: 'utils.ts#validate', type: 'calls' });
    // handleRequest calls login
    graph.addEdge({ source: 'api.ts#handleRequest', target: 'auth.ts#login', type: 'calls' });
    // route calls handleRequest
    graph.addEdge({ source: 'router.ts#route', target: 'api.ts#handleRequest', type: 'calls' });
  });

  it('should find all dependents of a changed function', () => {
    const result = analyzeImpact(graph, 'utils.ts#validate');

    expect(result.source.name).toBe('validate');
    expect(result.impacted.length).toBe(3);
    expect(result.impacted[0]!.node.name).toBe('login');
    expect(result.impacted[0]!.distance).toBe(1);
    expect(result.impacted[1]!.node.name).toBe('handleRequest');
    expect(result.impacted[1]!.distance).toBe(2);
    expect(result.impacted[2]!.node.name).toBe('route');
    expect(result.impacted[2]!.distance).toBe(3);
  });

  it('should respect maxDepth', () => {
    const result = analyzeImpact(graph, 'utils.ts#validate', { maxDepth: 1 });
    expect(result.impacted.length).toBe(1);
    expect(result.impacted[0]!.node.name).toBe('login');
  });

  it('should compute correct stats', () => {
    const result = analyzeImpact(graph, 'utils.ts#validate');
    expect(result.stats.totalImpacted).toBe(3);
    expect(result.stats.fileCount).toBe(3);
    expect(result.stats.maxDepth).toBe(3);
  });

  it('should track edge types in path', () => {
    const result = analyzeImpact(graph, 'utils.ts#validate');
    expect(result.impacted[0]!.edgeTypes).toEqual(['calls']);
  });

  it('should throw for non-existent node', () => {
    expect(() => analyzeImpact(graph, 'nope')).toThrow('Node not found: nope');
  });

  it('should analyze dependencies (outbound)', () => {
    const result = analyzeImpact(graph, 'router.ts#route', { direction: 'dependencies' });
    expect(result.impacted.length).toBe(3);
    expect(result.impacted[0]!.node.name).toBe('handleRequest');
    expect(result.impacted[1]!.node.name).toBe('login');
    expect(result.impacted[2]!.node.name).toBe('validate');
  });

  it('should format impact summary', () => {
    const result = analyzeImpact(graph, 'utils.ts#validate');
    const summary = formatImpactSummary(result);

    expect(summary).toContain('Impact analysis for: validate');
    expect(summary).toContain('Total impacted: 3');
    expect(summary).toContain('auth.ts');
    expect(summary).toContain('api.ts');
    expect(summary).toContain('router.ts');
  });
});
