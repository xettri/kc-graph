import { describe, it, expect } from 'vitest';
import { parseTypeScriptSource, indexSourceFile } from '../../src/parser/typescript-parser.js';
import { CodeGraph } from '../../src/core/graph.js';

const SAMPLE_SOURCE = `
import { Logger } from './logger';

export const MAX_RETRIES = 3;

export interface User {
  id: string;
  name: string;
}

export type Role = 'admin' | 'user';

/**
 * Authenticates a user with the given credentials.
 */
export async function login(username: string, password: string): Promise<User> {
  const user = await findUser(username);
  return user;
}

function findUser(username: string): Promise<User> {
  return {} as any;
}

export class AuthService {
  private logger: Logger;

  async authenticate(user: User): Promise<boolean> {
    return true;
  }
}
`;

describe('TypeScript Parser', () => {
  describe('parseTypeScriptSource', () => {
    it('should extract the file node', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const fileNode = result.nodes.find((n) => n.type === 'file');
      expect(fileNode).toBeDefined();
      expect(fileNode!.name).toBe('auth.ts');
      expect(fileNode!.qualifiedName).toBe('src/auth.ts');
    });

    it('should extract functions', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const functions = result.nodes.filter((n) => n.type === 'function');
      const names = functions.map((n) => n.name);
      expect(names).toContain('login');
      expect(names).toContain('findUser');
    });

    it('should extract function signatures', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const loginNode = result.nodes.find((n) => n.name === 'login');
      expect(loginNode).toBeDefined();
      expect(loginNode!.signature).toContain('async');
      expect(loginNode!.signature).toContain('login');
      expect(loginNode!.signature).toContain('username: string');
    });

    it('should extract classes', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const classNode = result.nodes.find((n) => n.type === 'class');
      expect(classNode).toBeDefined();
      expect(classNode!.name).toBe('AuthService');
    });

    it('should extract class methods', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const method = result.nodes.find((n) => n.name === 'authenticate');
      expect(method).toBeDefined();
      expect(method!.type).toBe('function');
      expect(method!.qualifiedName).toBe('src/auth.ts#AuthService.authenticate');
    });

    it('should extract variables', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const varNode = result.nodes.find((n) => n.name === 'MAX_RETRIES');
      expect(varNode).toBeDefined();
      expect(varNode!.type).toBe('variable');
      expect(varNode!.metadata['isConst']).toBe(true);
    });

    it('should extract interfaces and types', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const types = result.nodes.filter((n) => n.type === 'type');
      const names = types.map((n) => n.name);
      expect(names).toContain('User');
      expect(names).toContain('Role');
    });

    it('should extract import edges', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const imports = result.edges.filter((e) => e.type === 'imports');
      expect(imports.length).toBe(1);
      expect(imports[0]!.targetQualifiedName).toBe('./logger');
    });

    it('should extract contains edges', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const contains = result.edges.filter((e) => e.type === 'contains');
      expect(contains.length).toBeGreaterThan(0);
      expect(contains.some((e) => e.targetQualifiedName === 'src/auth.ts#login')).toBe(true);
    });

    it('should extract export edges', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const exports = result.edges.filter((e) => e.type === 'exports');
      expect(exports.length).toBeGreaterThan(0);
      expect(exports.some((e) => e.targetQualifiedName === 'src/auth.ts#login')).toBe(true);
      // findUser is NOT exported
      expect(exports.some((e) => e.targetQualifiedName === 'src/auth.ts#findUser')).toBe(false);
    });

    it('should capture JSDoc comments', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE, { includeJSDoc: true });
      const loginNode = result.nodes.find((n) => n.name === 'login');
      expect(loginNode!.metadata['jsdoc']).toContain('Authenticates a user');
    });

    it('should respect maxContentLength', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE, { maxContentLength: 20 });
      const loginNode = result.nodes.find((n) => n.name === 'login');
      expect(loginNode!.content.length).toBeLessThanOrEqual(40); // 20 + truncation suffix
    });

    it('should capture line numbers', () => {
      const result = parseTypeScriptSource('src/auth.ts', SAMPLE_SOURCE);
      const loginNode = result.nodes.find((n) => n.name === 'login');
      expect(loginNode!.startLine).toBeGreaterThan(0);
      expect(loginNode!.endLine).toBeGreaterThanOrEqual(loginNode!.startLine);
    });
  });

  describe('indexSourceFile', () => {
    it('should add parsed nodes to a graph', () => {
      const graph = new CodeGraph();
      const count = indexSourceFile(graph, 'src/auth.ts', SAMPLE_SOURCE);

      expect(count).toBeGreaterThan(5);
      expect(graph.nodeCount).toBeGreaterThan(5);

      const login = graph.resolve('login');
      expect(login).toBeDefined();
      expect(login!.type).toBe('function');
    });

    it('should support incremental re-indexing', () => {
      const graph = new CodeGraph();
      indexSourceFile(graph, 'src/auth.ts', SAMPLE_SOURCE);
      const firstCount = graph.nodeCount;

      // Re-index same file — should replace, not duplicate
      indexSourceFile(graph, 'src/auth.ts', SAMPLE_SOURCE);
      expect(graph.nodeCount).toBe(firstCount);
    });

    it('should create edges between nodes', () => {
      const graph = new CodeGraph();
      indexSourceFile(graph, 'src/auth.ts', SAMPLE_SOURCE);

      const fileNode = graph.resolve('src/auth.ts');
      expect(fileNode).toBeDefined();

      const children = graph.getSuccessors(fileNode!.id, ['contains']);
      expect(children.length).toBeGreaterThan(0);
    });
  });
});
