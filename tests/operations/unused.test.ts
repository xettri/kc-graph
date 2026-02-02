import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { findUnused, formatUnusedSummary } from '../../src/operations/unused.js';

describe('findUnused', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();

    // File: src/utils.ts
    graph.addNode({
      type: 'file',
      name: 'utils.ts',
      qualifiedName: 'src/utils.ts',
      location: { file: 'src/utils.ts', startLine: 1, endLine: 30, startColumn: 0, endColumn: 0 },
    });

    // Used function — called by handler
    graph.addNode({
      type: 'function',
      name: 'validate',
      qualifiedName: 'src/utils.ts#validate',
      content: 'function validate() {}',
      signature: 'function validate()',
      location: { file: 'src/utils.ts', startLine: 1, endLine: 5, startColumn: 0, endColumn: 0 },
    });

    // Unused function — no callers, not exported
    graph.addNode({
      type: 'function',
      name: 'deprecatedHelper',
      qualifiedName: 'src/utils.ts#deprecatedHelper',
      content: 'function deprecatedHelper() {}',
      signature: 'function deprecatedHelper()',
      location: { file: 'src/utils.ts', startLine: 7, endLine: 10, startColumn: 0, endColumn: 0 },
    });

    // Exported but never imported — medium confidence
    graph.addNode({
      type: 'function',
      name: 'unusedExport',
      qualifiedName: 'src/utils.ts#unusedExport',
      content: 'export function unusedExport() {}',
      signature: 'function unusedExport()',
      location: {
        file: 'src/utils.ts',
        startLine: 12,
        endLine: 15,
        startColumn: 0,
        endColumn: 0,
      },
    });

    // File: src/handler.ts
    graph.addNode({
      type: 'file',
      name: 'handler.ts',
      qualifiedName: 'src/handler.ts',
      location: {
        file: 'src/handler.ts',
        startLine: 1,
        endLine: 20,
        startColumn: 0,
        endColumn: 0,
      },
    });

    graph.addNode({
      type: 'function',
      name: 'handleRequest',
      qualifiedName: 'src/handler.ts#handleRequest',
      content: 'function handleRequest() { validate(); }',
      signature: 'function handleRequest()',
      location: {
        file: 'src/handler.ts',
        startLine: 1,
        endLine: 10,
        startColumn: 0,
        endColumn: 0,
      },
    });

    // Edges
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#validate',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#deprecatedHelper',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#unusedExport',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#unusedExport',
      type: 'exports',
    });
    graph.addEdge({
      source: 'src/handler.ts',
      target: 'src/handler.ts#handleRequest',
      type: 'contains',
    });
    graph.addEdge({
      source: 'src/handler.ts#handleRequest',
      target: 'src/utils.ts#validate',
      type: 'calls',
    });
  });

  it('should find unused functions with no callers', () => {
    const results = findUnused(graph);
    const names = results.map((r) => r.node.name);
    expect(names).toContain('deprecatedHelper');
  });

  it('should find exported but never imported functions', () => {
    const results = findUnused(graph);
    const unusedExport = results.find((r) => r.node.name === 'unusedExport');
    expect(unusedExport).toBeDefined();
    expect(unusedExport!.confidence).toBe('medium');
    expect(unusedExport!.reason).toBe('no-importers');
  });

  it('should NOT flag functions that have callers', () => {
    const results = findUnused(graph);
    const names = results.map((r) => r.node.name);
    // validate is called by handleRequest
    expect(names).not.toContain('validate');
    // handleRequest has no callers in this graph, so it IS correctly flagged
    expect(names).toContain('handleRequest');
  });

  it('should filter by type', () => {
    // Add an unused variable
    graph.addNode({
      type: 'variable',
      name: 'UNUSED_CONST',
      qualifiedName: 'src/utils.ts#UNUSED_CONST',
      content: 'const UNUSED_CONST = 42',
      signature: 'const UNUSED_CONST',
      location: {
        file: 'src/utils.ts',
        startLine: 20,
        endLine: 20,
        startColumn: 0,
        endColumn: 0,
      },
    });
    graph.addEdge({
      source: 'src/utils.ts',
      target: 'src/utils.ts#UNUSED_CONST',
      type: 'contains',
    });

    const functionResults = findUnused(graph, { type: 'function' });
    const names = functionResults.map((r) => r.node.name);
    expect(names).not.toContain('UNUSED_CONST');
    expect(names).toContain('deprecatedHelper');
  });

  it('should filter by path', () => {
    const results = findUnused(graph, { path: 'src/handler.ts' });
    // handleRequest is unused from the outside but this tests path filtering
    const files = results.map((r) => r.node.location?.file);
    for (const file of files) {
      expect(file).toMatch(/^src\/handler\.ts/);
    }
  });

  it('should sort high confidence first', () => {
    const results = findUnused(graph);
    if (results.length >= 2) {
      const highIndex = results.findIndex((r) => r.confidence === 'high');
      const mediumIndex = results.findIndex((r) => r.confidence === 'medium');
      if (highIndex !== -1 && mediumIndex !== -1) {
        expect(highIndex).toBeLessThan(mediumIndex);
      }
    }
  });

  it('should exclude entry point files', () => {
    // Add node in an index.ts file
    graph.addNode({
      type: 'file',
      name: 'index.ts',
      qualifiedName: 'src/index.ts',
      location: {
        file: 'src/index.ts',
        startLine: 1,
        endLine: 5,
        startColumn: 0,
        endColumn: 0,
      },
    });
    graph.addNode({
      type: 'function',
      name: 'entryPoint',
      qualifiedName: 'src/index.ts#entryPoint',
      content: 'function entryPoint() {}',
      signature: 'function entryPoint()',
      location: {
        file: 'src/index.ts',
        startLine: 1,
        endLine: 3,
        startColumn: 0,
        endColumn: 0,
      },
    });
    graph.addEdge({
      source: 'src/index.ts',
      target: 'src/index.ts#entryPoint',
      type: 'contains',
    });

    const results = findUnused(graph);
    const names = results.map((r) => r.node.name);
    expect(names).not.toContain('entryPoint');
  });

  it('should format summary correctly', () => {
    const results = findUnused(graph);
    const summary = formatUnusedSummary(results);
    expect(summary).toContain('potentially unused');
    expect(summary).toContain('deprecatedHelper');
  });

  it('should return empty message when no unused symbols', () => {
    const emptyGraph = new CodeGraph();
    const results = findUnused(emptyGraph);
    const summary = formatUnusedSummary(results);
    expect(summary).toBe('No unused symbols found.');
  });
});
