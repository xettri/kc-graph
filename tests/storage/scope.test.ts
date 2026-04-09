import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ScopeMeta, UserConfig, ScopeInfo } from '../../src/storage/types.js';
import type { RegistryEntry } from '../../src/storage/types.js';
import {
  validateScopeName,
  scopePath,
  DEFAULT_SCOPE,
  getActiveScope,
  setActiveScope,
  resetActiveScope,
  resolveScope,
  getGlobalRoot,
  listScopes,
  scopeExists,
  deleteScope,
  ensureScopeDir,
  detectGitBranch,
} from '../../src/storage/scope.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kc-scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('scope types', () => {
  it('ScopeMeta has required fields', () => {
    const meta: ScopeMeta = { name: 'develop', createdAt: Date.now() };
    expect(meta.name).toBe('develop');
    expect(meta.createdAt).toBeGreaterThan(0);
  });

  it('UserConfig has activeScope', () => {
    const config: UserConfig = { activeScope: 'develop' };
    expect(config.activeScope).toBe('develop');
  });

  it('ScopeInfo has all fields', () => {
    const info: ScopeInfo = {
      name: 'develop',
      projectCount: 3,
      lastSync: Date.now(),
      createdAt: Date.now(),
      active: true,
    };
    expect(info.name).toBe('develop');
    expect(info.active).toBe(true);
  });

  it('RegistryEntry supports optional branch field', () => {
    const entry: RegistryEntry = {
      path: '/tmp/test',
      name: 'test',
      lastSync: Date.now(),
      branch: 'develop',
    };
    expect(entry.branch).toBe('develop');

    const noBranch: RegistryEntry = {
      path: '/tmp/test',
      name: 'test',
      lastSync: Date.now(),
    };
    expect(noBranch.branch).toBeUndefined();
  });
});

describe('active scope management', () => {
  let originalRoot: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalRoot = process.env.KC_GRAPH_HOME ?? '';
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    if (originalRoot) {
      process.env.KC_GRAPH_HOME = originalRoot;
    } else {
      delete process.env.KC_GRAPH_HOME;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns default when no config exists', () => {
    expect(getActiveScope()).toBe('default');
  });

  it('setActiveScope writes config and getActiveScope reads it', () => {
    setActiveScope('develop');
    expect(getActiveScope()).toBe('develop');
  });

  it('resetActiveScope sets back to default', () => {
    setActiveScope('staging');
    expect(getActiveScope()).toBe('staging');
    resetActiveScope();
    expect(getActiveScope()).toBe('default');
  });

  it('setActiveScope validates name', () => {
    expect(() => setActiveScope('Bad Name')).toThrow(/Invalid scope name/);
  });
});

describe('resolveScope', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
    delete process.env.KC_GRAPH_SCOPE;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    delete process.env.KC_GRAPH_SCOPE;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('explicit flag wins over everything', () => {
    process.env.KC_GRAPH_SCOPE = 'env-scope';
    setActiveScope('config-scope');
    expect(resolveScope('flag-scope')).toBe('flag-scope');
  });

  it('env var wins over config', () => {
    setActiveScope('config-scope');
    process.env.KC_GRAPH_SCOPE = 'env-scope';
    expect(resolveScope()).toBe('env-scope');
  });

  it('config wins over default', () => {
    setActiveScope('config-scope');
    expect(resolveScope()).toBe('config-scope');
  });

  it('falls back to default', () => {
    expect(resolveScope()).toBe('default');
  });

  it('validates explicit scope name', () => {
    expect(() => resolveScope('Bad Name')).toThrow(/Invalid scope name/);
  });
});

describe('ensureScopeDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates scope directory with scope.json', () => {
    ensureScopeDir('develop', true);
    const scopeDir = join(tmpDir, 'develop');
    expect(existsSync(scopeDir)).toBe(true);
    expect(existsSync(join(scopeDir, 'scope.json'))).toBe(true);

    const meta = JSON.parse(readFileSync(join(scopeDir, 'scope.json'), 'utf-8'));
    expect(meta.name).toBe('develop');
    expect(meta.createdAt).toBeGreaterThan(0);
  });

  it('does not overwrite existing scope.json', () => {
    ensureScopeDir('develop', true);
    const first = JSON.parse(readFileSync(join(tmpDir, 'develop', 'scope.json'), 'utf-8'));

    ensureScopeDir('develop', true);
    const second = JSON.parse(readFileSync(join(tmpDir, 'develop', 'scope.json'), 'utf-8'));

    expect(first.createdAt).toBe(second.createdAt);
  });
});

describe('scopeExists', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for non-existent scope', () => {
    expect(scopeExists('develop', true)).toBe(false);
  });

  it('returns true after ensureScopeDir', () => {
    ensureScopeDir('develop', true);
    expect(scopeExists('develop', true)).toBe(true);
  });
});

describe('listScopes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no scopes exist', () => {
    expect(listScopes(true)).toEqual([]);
  });

  it('lists created scopes', () => {
    ensureScopeDir('develop', true);
    ensureScopeDir('staging', true);

    const scopes = listScopes(true);
    const names = scopes.map((s) => s.name).sort();
    expect(names).toEqual(['develop', 'staging']);
  });

  it('marks active scope', () => {
    ensureScopeDir('develop', true);
    ensureScopeDir('staging', true);
    setActiveScope('develop');

    const scopes = listScopes(true);
    const develop = scopes.find((s) => s.name === 'develop');
    const staging = scopes.find((s) => s.name === 'staging');
    expect(develop?.active).toBe(true);
    expect(staging?.active).toBe(false);
  });
});

describe('deleteScope', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes an existing scope', () => {
    ensureScopeDir('develop', true);
    expect(scopeExists('develop', true)).toBe(true);

    deleteScope('develop', true);
    expect(scopeExists('develop', true)).toBe(false);
  });

  it('rejects deleting default scope', () => {
    ensureScopeDir('default', true);
    expect(() => deleteScope('default', true)).toThrow(/Cannot delete/);
  });

  it('throws for non-existent scope', () => {
    expect(() => deleteScope('nonexistent', true)).toThrow(/does not exist/);
  });
});

describe('detectGitBranch', () => {
  it('returns null for non-git directory', () => {
    const tmpDir = makeTmpDir();
    try {
      expect(detectGitBranch(tmpDir)).toBeNull();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns a branch name for a git repo', () => {
    const branch = detectGitBranch(process.cwd());
    expect(typeof branch).toBe('string');
    expect(branch!.length).toBeGreaterThan(0);
  });
});
