import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveStore, createStore } from '../../src/storage/resolver.js';

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
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createStore', () => {
    it('should create a local store by default', () => {
      const store = createStore(projectDir);
      expect(store.storagePath).toBe(join(projectDir, '.kc-graph'));
    });
  });

  describe('resolveStore', () => {
    it('should resolve to local store when meta.json exists', () => {
      const localPath = join(projectDir, '.kc-graph');
      mkdirSync(localPath, { recursive: true });
      writeFileSync(join(localPath, 'meta.json'), JSON.stringify({ version: '2.0' }));

      const store = resolveStore(projectDir);
      expect(store.storagePath).toBe(localPath);
    });

    it('should default to local when no storage found', () => {
      const store = resolveStore(projectDir);
      expect(store.storagePath).toBe(join(projectDir, '.kc-graph'));
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
