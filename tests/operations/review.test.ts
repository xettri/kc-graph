import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { reviewChanges, formatReviewSummary } from '../../src/operations/review.js';

describe('reviewChanges', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();

    // src/utils.ts with validate function
    graph.addNode({
      type: 'file',
      name: 'utils.ts',
      qualifiedName: 'src/utils.ts',
      location: { file: 'src/utils.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'validate',
      qualifiedName: 'src/utils.ts#validate',
      content: 'function validate(input: string) { return input.length > 0; }',
      signature: 'function validate(input: string): boolean',
      location: { file: 'src/utils.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'format',
      qualifiedName: 'src/utils.ts#format',
      content: 'function format(s: string) { return s.trim(); }',
      signature: 'function format(s: string): string',
      location: {
        file: 'src/utils.ts',
        startLine: 7,
        endLine: 10,
        startColumn: 0,
        endColumn: 0,
      },
    });

    // src/auth.ts with login function that calls validate
    graph.addNode({
      type: 'file',
      name: 'auth.ts',
      qualifiedName: 'src/auth.ts',
      location: { file: 'src/auth.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'login',
      qualifiedName: 'src/auth.ts#login',
      content: 'async function login(user: string) { validate(user); }',
      signature: 'async function login(user: string): Promise<void>',
      location: { file: 'src/auth.ts', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
    });

    // src/api.ts that calls login
    graph.addNode({
      type: 'file',
      name: 'api.ts',
      qualifiedName: 'src/api.ts',
      location: { file: 'src/api.ts', startLine: 1, endLine: 15, startColumn: 0, endColumn: 0 },
    });
    graph.addNode({
      type: 'function',
      name: 'handleRequest',
      qualifiedName: 'src/api.ts#handleRequest',
      content: 'function handleRequest() { login("admin"); }',
      signature: 'function handleRequest(): void',
      location: { file: 'src/api.ts', startLine: 1, endLine: 8, startColumn: 0, endColumn: 0 },
    });

    // Edges
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#validate',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#format',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/auth.ts',
      target: 'src/auth.ts#login',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/api.ts',
      target: 'src/api.ts#handleRequest',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/auth.ts#login',
      target: 'src/utils.ts#validate',
      type: 'calls',
    });
    graph.addEdge({
      source: 'src/api.ts#handleRequest',
      target: 'src/auth.ts#login',
      type: 'calls',
    });
  });

  it('should detect symbols in changed files', () => {
    const result = reviewChanges(graph, ['src/utils.ts']);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.file).toBe('src/utils.ts');
    const names = result.changes[0]!.symbols.map((s) => s.name);
    expect(names).toContain('validate');
    expect(names).toContain('format');
  });

  it('should trace impact of changed symbols', () => {
    const result = reviewChanges(graph, ['src/utils.ts']);
    expect(result.impact.totalImpacted).toBeGreaterThan(0);
    const impactedNames = result.impact.impactedSymbols.map((s) => s.name);
    expect(impactedNames).toContain('login');
  });

  it('should include context for the blast radius', () => {
    const result = reviewChanges(graph, ['src/utils.ts']);
    expect(result.context).toBeTruthy();
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('should handle multiple changed files', () => {
    const result = reviewChanges(graph, ['src/utils.ts', 'src/auth.ts']);
    expect(result.changes).toHaveLength(2);
    const files = result.changes.map((c) => c.file);
    expect(files).toContain('src/utils.ts');
    expect(files).toContain('src/auth.ts');
  });

  it('should handle non-existent files gracefully', () => {
    const result = reviewChanges(graph, ['src/nonexistent.ts']);
    expect(result.changes).toHaveLength(0);
    expect(result.impact.totalImpacted).toBe(0);
  });

  it('should respect maxTokens', () => {
    const result = reviewChanges(graph, ['src/utils.ts'], 100);
    expect(result.estimatedTokens).toBeLessThanOrEqual(100);
  });

  it('should format review summary', () => {
    const result = reviewChanges(graph, ['src/utils.ts']);
    const summary = formatReviewSummary(result);
    expect(summary).toContain('## Changes');
    expect(summary).toContain('src/utils.ts');
    expect(summary).toContain('## Impact');
    expect(summary).toContain('## Code Context');
  });

  it('should show no impact message when no downstream effects', () => {
    // format has no callers, so changing only it should show limited impact
    const isolated = new CodeGraph();
    isolated.addNode({
      type: 'file',
      name: 'solo.ts',
      qualifiedName: 'src/solo.ts',
      location: {
        file: 'src/solo.ts',
        startLine: 1,
        endLine: 5,
        startColumn: 0,
        endColumn: 0,
      },
    });
    isolated.addNode({
      type: 'function',
      name: 'lonely',
      qualifiedName: 'src/solo.ts#lonely',
      content: 'function lonely() {}',
      signature: 'function lonely()',
      location: {
        file: 'src/solo.ts',
        startLine: 1,
        endLine: 3,
        startColumn: 0,
        endColumn: 0,
      },
    });
    isolated.addEdge({
      source: 'src/solo.ts',
      target: 'src/solo.ts#lonely',
      type: 'contains',
    });

    const result = reviewChanges(isolated, ['src/solo.ts']);
    const summary = formatReviewSummary(result);
    expect(summary).toContain('No downstream impact detected');
  });
});
