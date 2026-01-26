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
      // File-level import + named import for Logger
      expect(imports.length).toBe(2);
      expect(imports.some((e) => e.targetQualifiedName === 'src/logger.ts')).toBe(true);
      expect(imports.some((e) => e.targetQualifiedName === 'src/logger.ts#Logger')).toBe(true);
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

  describe('arrow functions', () => {
    const ARROW_SOURCE = `
export const greet = (name: string): string => {
  return format(name);
};

const format = (s: string) => s.trim();

export const handler = async (req: Request): Promise<Response> => {
  return new Response('ok');
};
`;

    it('should extract arrow functions as function nodes', () => {
      const result = parseTypeScriptSource('src/utils.ts', ARROW_SOURCE);
      const fns = result.nodes.filter((n) => n.type === 'function');
      expect(fns.some((n) => n.name === 'greet')).toBe(true);
      expect(fns.some((n) => n.name === 'format')).toBe(true);
      expect(fns.some((n) => n.name === 'handler')).toBe(true);
    });

    it('should mark arrow functions with isArrow metadata', () => {
      const result = parseTypeScriptSource('src/utils.ts', ARROW_SOURCE);
      const greet = result.nodes.find((n) => n.name === 'greet');
      expect(greet!.metadata['isArrow']).toBe(true);
    });

    it('should generate correct signatures for arrow functions', () => {
      const result = parseTypeScriptSource('src/utils.ts', ARROW_SOURCE);
      const greet = result.nodes.find((n) => n.name === 'greet');
      expect(greet!.signature).toContain('greet');
      expect(greet!.signature).toContain('name: string');
    });

    it('should detect async arrow functions', () => {
      const result = parseTypeScriptSource('src/utils.ts', ARROW_SOURCE);
      const handler = result.nodes.find((n) => n.name === 'handler');
      expect(handler!.signature).toContain('async');
    });
  });

  describe('call extraction', () => {
    const CALL_SOURCE = `
function main() {
  const result = helper();
  process(result);
}

function helper(): string {
  return 'data';
}

function process(data: string): void {
  console.log(data);
}

const runner = () => {
  main();
};
`;

    it('should extract calls edges between functions', () => {
      const graph = new CodeGraph();
      indexSourceFile(graph, 'src/app.ts', CALL_SOURCE);

      const edges = [...graph.allEdges()].filter((e) => e.type === 'calls');
      expect(edges.length).toBeGreaterThan(0);

      // main calls helper
      const mainNode = graph.resolve('src/app.ts#main');
      const helperNode = graph.resolve('src/app.ts#helper');
      expect(mainNode).toBeDefined();
      expect(helperNode).toBeDefined();

      const mainCallsHelper = edges.some(
        (e) => e.source === mainNode!.id && e.target === helperNode!.id,
      );
      expect(mainCallsHelper).toBe(true);
    });

    it('should extract calls from arrow functions', () => {
      const graph = new CodeGraph();
      indexSourceFile(graph, 'src/app.ts', CALL_SOURCE);

      const edges = [...graph.allEdges()].filter((e) => e.type === 'calls');
      const runnerNode = graph.resolve('src/app.ts#runner');
      const mainNode = graph.resolve('src/app.ts#main');
      expect(runnerNode).toBeDefined();

      const runnerCallsMain = edges.some(
        (e) => e.source === runnerNode!.id && e.target === mainNode!.id,
      );
      expect(runnerCallsMain).toBe(true);
    });

    it('should extract multiple calls from the same function', () => {
      const graph = new CodeGraph();
      indexSourceFile(graph, 'src/app.ts', CALL_SOURCE);

      const edges = [...graph.allEdges()].filter((e) => e.type === 'calls');
      const mainNode = graph.resolve('src/app.ts#main');

      // main calls both helper and process
      const mainCalls = edges.filter((e) => e.source === mainNode!.id);
      expect(mainCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('class methods and constructors', () => {
    const CLASS_SOURCE = `
class Service {
  constructor(private db: Database) {
    this.init();
  }

  init(): void {}

  async fetch(id: string): Promise<Data> {
    return this.db.get(id);
  }

  handler = (event: Event) => {
    this.fetch(event.id);
  };
}
`;

    it('should extract constructors', () => {
      const result = parseTypeScriptSource('src/service.ts', CLASS_SOURCE);
      const ctor = result.nodes.find((n) => n.name === 'constructor');
      expect(ctor).toBeDefined();
      expect(ctor!.qualifiedName).toBe('src/service.ts#Service.constructor');
    });

    it('should extract arrow function class properties', () => {
      const result = parseTypeScriptSource('src/service.ts', CLASS_SOURCE);
      const handler = result.nodes.find((n) => n.name === 'handler');
      expect(handler).toBeDefined();
      expect(handler!.qualifiedName).toBe('src/service.ts#Service.handler');
    });

    it('should extract calls from class methods', () => {
      const graph = new CodeGraph();
      indexSourceFile(graph, 'src/service.ts', CLASS_SOURCE);

      const edges = [...graph.allEdges()].filter((e) => e.type === 'calls');
      // constructor calls init
      const ctor = graph.resolve('src/service.ts#Service.constructor');
      const init = graph.resolve('src/service.ts#Service.init');
      if (ctor && init) {
        const ctorCallsInit = edges.some(
          (e) => e.source === ctor.id && e.target === init.id,
        );
        expect(ctorCallsInit).toBe(true);
      }
    });
  });

  describe('import resolution', () => {
    it('should resolve relative imports to file paths', () => {
      const source = `import { foo } from './utils';`;
      const result = parseTypeScriptSource('src/app.ts', source);
      const imports = result.edges.filter((e) => e.type === 'imports');
      expect(imports.some((e) => e.targetQualifiedName === 'src/utils.ts')).toBe(true);
    });

    it('should resolve parent directory imports', () => {
      const source = `import { config } from '../config';`;
      const result = parseTypeScriptSource('src/lib/app.ts', source);
      const imports = result.edges.filter((e) => e.type === 'imports');
      expect(imports.some((e) => e.targetQualifiedName === 'src/config.ts')).toBe(true);
    });

    it('should leave bare specifiers as-is', () => {
      const source = `import express from 'express';`;
      const result = parseTypeScriptSource('src/app.ts', source);
      const imports = result.edges.filter((e) => e.type === 'imports');
      expect(imports.some((e) => e.targetQualifiedName === 'express')).toBe(true);
    });

    it('should create named import edges', () => {
      const source = `import { readFile, writeFile } from 'node:fs/promises';`;
      const result = parseTypeScriptSource('src/io.ts', source);
      const imports = result.edges.filter((e) => e.type === 'imports');
      expect(imports.some((e) => e.targetQualifiedName === 'node:fs/promises#readFile')).toBe(true);
      expect(imports.some((e) => e.targetQualifiedName === 'node:fs/promises#writeFile')).toBe(true);
    });
  });

  describe('re-exports', () => {
    it('should detect export { x } from "./mod"', () => {
      const source = `export { helper } from './utils';`;
      const result = parseTypeScriptSource('src/index.ts', source);
      const exports = result.edges.filter((e) => e.type === 'exports');
      expect(exports.some((e) => e.targetQualifiedName === 'src/utils.ts#helper')).toBe(true);
    });

    it('should detect local named exports', () => {
      const source = `
function foo() {}
export { foo };
`;
      const result = parseTypeScriptSource('src/mod.ts', source);
      const exports = result.edges.filter((e) => e.type === 'exports');
      expect(exports.some((e) => e.targetQualifiedName === 'src/mod.ts#foo')).toBe(true);
    });
  });
});
