import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { resolveStore, createStore, removeProject } from '../../src/storage/resolver.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Storage Resolver', () => {
  let tmpDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    projectDir = join(tmpDir, 'project');
    mkdirSync(projectDir, { recursive: true });
    process.env.KC_GRAPH_HOME = join(tmpDir, 'global-home');
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createStore', () => {
    it('should create a local store by default', () => {
      const store = createStore(projectDir);
      expect(store.storagePath).toBe(join(projectDir, '.kc-graph', 'default'));
    });
  });

  describe('resolveStore', () => {
    it('should resolve to local store when meta.json exists', () => {
      const localPath = join(projectDir, '.kc-graph', 'default');
      mkdirSync(localPath, { recursive: true });
      writeFileSync(join(localPath, 'meta.json'), JSON.stringify({ version: '2.0' }));

      const store = resolveStore(projectDir);
      expect(store.storagePath).toBe(localPath);
    });

    it('should default to local when no storage found', () => {
      const store = resolveStore(projectDir);
      expect(store.storagePath).toBe(join(projectDir, '.kc-graph', 'default'));
    });
  });

  describe('config overrides', () => {
    it('should pass config to the store', () => {
      const store = createStore(projectDir, { config: { chunkSize: 1024, chunkIdLength: 8 } });
      store.init(projectDir);

      const meta = store.readMeta();
      expect(meta.config.chunkSize).toBe(1024);
      expect(meta.config.chunkIdLength).toBe(8);
    });
  });
});

describe('scoped resolver', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createStore with scope creates storage under scope directory', () => {
    const projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });

    const store = createStore(projectDir, { global: true, scope: 'develop' });
    expect(store.storagePath).toContain('develop');
    expect(store.storagePath).toContain('projects');
  });

  it('different scopes produce different storage paths', () => {
    const projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });

    const devStore = createStore(projectDir, { global: true, scope: 'develop' });
    const prodStore = createStore(projectDir, { global: true, scope: 'prod' });
    expect(devStore.storagePath).not.toBe(prodStore.storagePath);
  });

  it('local scoped store uses project/.kc-graph/<scope>/', () => {
    const projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });

    const store = createStore(projectDir, { scope: 'staging' });
    expect(store.storagePath).toBe(join(projectDir, '.kc-graph', 'staging'));
  });

  it('no scope defaults to "default"', () => {
    const projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });

    const store = createStore(projectDir, { global: true });
    expect(store.storagePath).toContain('default');
  });
});

describe('removeProject', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    process.env.KC_GRAPH_HOME = tmpDir;
  });

  afterEach(() => {
    delete process.env.KC_GRAPH_HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes a global project and its registry entry', () => {
    const projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });

    // Init storage
    const store = createStore(projectDir, { global: true, scope: 'develop' });
    store.init(projectDir);
    expect(store.exists()).toBe(true);

    // Remove it
    const { name, storagePath } = removeProject(projectDir, { global: true, scope: 'develop' });
    expect(name).toBe('my-project');
    expect(existsSync(storagePath)).toBe(false);
  });

  it('removes local project storage', () => {
    const projectDir = join(tmpDir, 'my-project');
    mkdirSync(projectDir, { recursive: true });

    const store = createStore(projectDir, { scope: 'develop' });
    store.init(projectDir);
    expect(store.exists()).toBe(true);

    const { name } = removeProject(projectDir, { scope: 'develop' });
    expect(name).toBe('my-project');
    expect(store.exists()).toBe(false);
  });

  it('throws for non-existent global project', () => {
    const projectDir = join(tmpDir, 'missing');
    mkdirSync(projectDir, { recursive: true });

    expect(() => removeProject(projectDir, { global: true })).toThrow(/not found in registry/i);
  });

  it('throws for non-existent local project', () => {
    const projectDir = join(tmpDir, 'missing');
    mkdirSync(projectDir, { recursive: true });

    expect(() => removeProject(projectDir)).toThrow(/No local storage/);
  });
});
