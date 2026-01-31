import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../../src/core/graph.js';
import { query } from '../../src/operations/query.js';

describe('GraphQuery', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = new CodeGraph();

    graph.addNode({
      type: 'function',
      name: 'handleLogin',
      qualifiedName: 'src/auth.ts#handleLogin',
      content: 'async function handleLogin(user: User) { ... }',
      signature: 'async function handleLogin(user: User): Promise<Token>',
      location: { file: 'src/auth.ts', startLine: 10, endLine: 25, startColumn: 0, endColumn: 0 },
      metadata: { isAsync: true },
    });

    graph.addNode({
      type: 'function',
      name: 'handleLogout',
      qualifiedName: 'src/auth.ts#handleLogout',
      content: 'function handleLogout() { ... }',
      signature: 'function handleLogout(): void',
      location: { file: 'src/auth.ts', startLine: 27, endLine: 35, startColumn: 0, endColumn: 0 },
    });

    graph.addNode({
      type: 'class',
      name: 'UserService',
      qualifiedName: 'src/user.ts#UserService',
      content: 'class UserService { ... }',
      location: { file: 'src/user.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
    });

    graph.addNode({
      type: 'variable',
      name: 'MAX_RETRIES',
      qualifiedName: 'src/config.ts#MAX_RETRIES',
      content: 'const MAX_RETRIES = 3',
      location: { file: 'src/config.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: 0 },
    });

    graph.addEdge({
      source: 'src/auth.ts#handleLogin',
      target: 'src/user.ts#UserService',
      type: 'calls',
    });
  });

  it('should filter by type', () => {
    const results = query(graph).ofType('function').results();
    expect(results.length).toBe(2);
  });

  it('should filter by file', () => {
    const results = query(graph).inFile('src/auth.ts').results();
    expect(results.length).toBe(2);
  });

  it('should filter by file regex', () => {
    const results = query(graph).inFile(/\.ts$/).results();
    expect(results.length).toBe(4);
  });

  it('should filter by name', () => {
    const results = query(graph).withName('handleLogin').results();
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('handleLogin');
  });

  it('should filter by name regex', () => {
    const results = query(graph)
      .withName(/^handle/)
      .results();
    expect(results.length).toBe(2);
  });

  it('should filter by content', () => {
    const results = query(graph).withContent(/async/).results();
    expect(results.length).toBe(1);
  });

  it('should filter by metadata', () => {
    const results = query(graph).withMetadata('isAsync', true).results();
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('handleLogin');
  });

  it('should chain multiple filters', () => {
    const results = query(graph)
      .ofType('function')
      .inFile('src/auth.ts')
      .withName(/login/i)
      .results();
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('handleLogin');
  });

  it('should filter by outbound edge', () => {
    const results = query(graph).withOutEdge('calls').results();
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('handleLogin');
  });

  it('should return count', () => {
    const count = query(graph).ofType('function').count();
    expect(count).toBe(2);
  });

  it('should return first match', () => {
    const result = query(graph).ofType('class').first();
    expect(result?.name).toBe('UserService');
  });

  it('should return undefined for no match', () => {
    const result = query(graph).ofType('module').first();
    expect(result).toBeUndefined();
  });
});
