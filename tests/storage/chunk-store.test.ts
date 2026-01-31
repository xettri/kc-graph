import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChunkStore } from '../../src/storage/chunk-store.js';
import { CodeGraph } from '../../src/core/graph.js';
import type { StorageConfig } from '../../src/storage/types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildTestGraph(): CodeGraph {
  const g = new CodeGraph();

  // File node
  g.addNode({
    id: 'src/app.ts',
    type: 'file',
    name: 'app.ts',
    qualifiedName: 'src/app.ts',
    content: '',
    signature: '',
    location: { file: 'src/app.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
    metadata: {},
  });

  // Function nodes
  g.addNode({
    id: 'src/app.ts#main',
    type: 'function',
    name: 'main',
    qualifiedName: 'src/app.ts#main',
    content: 'function main() { return hello(); }',
    signature: '() => void',
    location: { file: 'src/app.ts', startLine: 2, endLine: 5, startColumn: 0, endColumn: 1 },
    metadata: {},
  });

  g.addNode({
    id: 'src/app.ts#hello',
    type: 'function',
    name: 'hello',
    qualifiedName: 'src/app.ts#hello',
    content: 'function hello() { return "world"; }',
    signature: '() => string',
    location: { file: 'src/app.ts', startLine: 7, endLine: 9, startColumn: 0, endColumn: 1 },
    metadata: {},
  });

  // Second file
  g.addNode({
    id: 'src/utils.ts',
    type: 'file',
    name: 'utils.ts',
    qualifiedName: 'src/utils.ts',
    content: '',
    signature: '',
    location: { file: 'src/utils.ts', startLine: 1, endLine: 20, startColumn: 0, endColumn: 0 },
    metadata: {},
  });

  g.addNode({
    id: 'src/utils.ts#format',
    type: 'function',
    name: 'format',
    qualifiedName: 'src/utils.ts#format',
    content: 'function format(s: string) { return s.trim(); }',
    signature: '(s: string) => string',
    location: { file: 'src/utils.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 1 },
    metadata: {},
  });

  // Edges
  g.addEdge({
    source: 'src/app.ts',
    target: 'src/app.ts#main',
    type: 'contains',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/app.ts',
    target: 'src/app.ts#hello',
    type: 'contains',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/app.ts#main',
    target: 'src/app.ts#hello',
    type: 'calls',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/utils.ts',
    target: 'src/utils.ts#format',
    type: 'contains',
    weight: 1,
    metadata: {},
  });
  g.addEdge({
    source: 'src/app.ts#main',
    target: 'src/utils.ts#format',
    type: 'calls',
    weight: 0.5,
    metadata: {},
  });

  return g;
}

describe('ChunkStore', () => {
  let tmpDir: string;
  let projectDir: string;
  let storagePath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    projectDir = join(tmpDir, 'project');
    storagePath = join(tmpDir, 'storage');
    mkdirSync(projectDir, { recursive: true });

    // Create dummy source files so safeFileStat works
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'src', 'app.ts'), 'function main() {}');
    writeFileSync(join(projectDir, 'src', 'utils.ts'), 'function format() {}');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('init and exists', () => {
    it('should not exist before init', () => {
      const store = new ChunkStore(storagePath);
      expect(store.exists()).toBe(false);
    });

    it('should exist after init', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);
      expect(store.exists()).toBe(true);
    });

    it('should create meta.json and map.json', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const meta = store.readMeta();
      expect(meta.version).toBe('2.0');
      expect(meta.project).toBe(projectDir);
      expect(meta.stats.files).toBe(0);

      const map = store.readMap();
      expect(map.files).toEqual({});
      expect(map.chunks).toEqual({});
    });

    it('should create chunks directory', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);
      expect(existsSync(join(storagePath, 'chunks'))).toBe(true);
    });
  });

  describe('saveGraph and loadGraph', () => {
    it('should round-trip a graph through save/load', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const original = buildTestGraph();
      store.saveGraph(original, projectDir);

      const loaded = store.loadGraph();
      expect(loaded.nodeCount).toBe(original.nodeCount);
      expect(loaded.edgeCount).toBe(original.edgeCount);
    });

    it('should preserve node properties', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const original = buildTestGraph();
      store.saveGraph(original, projectDir);

      const loaded = store.loadGraph();
      const mainNode = loaded.getNode('src/app.ts#main');
      expect(mainNode).toBeDefined();
      expect(mainNode!.name).toBe('main');
      expect(mainNode!.type).toBe('function');
      expect(mainNode!.signature).toBe('() => void');
      expect(mainNode!.content).toBe('function main() { return hello(); }');
      expect(mainNode!.location?.file).toBe('src/app.ts');
    });

    it('should preserve edge properties', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const original = buildTestGraph();
      store.saveGraph(original, projectDir);

      const loaded = store.loadGraph();
      const edges = [...loaded.allEdges()];
      const callEdge = edges.find(
        (e) => e.source === 'src/app.ts#main' && e.target === 'src/app.ts#hello',
      );
      expect(callEdge).toBeDefined();
      expect(callEdge!.type).toBe('calls');
      expect(callEdge!.weight).toBe(1);
    });

    it('should create chunk files', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const chunksDir = join(storagePath, 'chunks');
      const files = readdirSync(chunksDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files.every((f) => f.endsWith('.json'))).toBe(true);
    });

    it('should update meta stats after save', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const meta = store.readMeta();
      expect(meta.stats.nodes).toBe(5);
      expect(meta.stats.edges).toBe(5);
      expect(meta.stats.files).toBe(2);
      expect(meta.stats.chunks).toBeGreaterThan(0);
    });

    it('should update map with file entries', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const map = store.readMap();
      expect(map.files['src/app.ts']).toBeDefined();
      expect(map.files['src/utils.ts']).toBeDefined();
      expect(map.files['src/app.ts']!.chunks.length).toBeGreaterThan(0);
    });
  });

  describe('chunking behavior', () => {
    it('should split into multiple chunks when data exceeds chunkSize', () => {
      // Use a tiny chunk size to force splitting
      const store = new ChunkStore(storagePath, { chunkSize: 200 });
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const map = store.readMap();
      const chunkCount = Object.keys(map.chunks).length;
      expect(chunkCount).toBeGreaterThan(1);
    });

    it('should use chunk IDs of configured length', () => {
      const store = new ChunkStore(storagePath, { chunkIdLength: 8 });
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const map = store.readMap();
      for (const chunkId of Object.keys(map.chunks)) {
        expect(chunkId.length).toBe(8);
      }
    });

    it('should distribute edges correctly across chunks', () => {
      const store = new ChunkStore(storagePath, { chunkSize: 200 });
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      // Load back and verify all edges are present
      const loaded = store.loadGraph();
      expect(loaded.edgeCount).toBe(graph.edgeCount);
    });
  });

  describe('writeChunk and deleteChunk', () => {
    it('should write and read a chunk', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const chunkData = { id: 'abc123', nodes: [], edges: [] };
      store.writeChunk(chunkData);

      const read = store.readChunk('abc123');
      expect(read.id).toBe('abc123');
    });

    it('should delete a chunk', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      store.writeChunk({ id: 'del001', nodes: [], edges: [] });
      expect(existsSync(join(storagePath, 'chunks', 'del001.json'))).toBe(true);

      store.deleteChunk('del001');
      expect(existsSync(join(storagePath, 'chunks', 'del001.json'))).toBe(false);
    });
  });

  describe('syncFiles', () => {
    it('should rewrite chunks for changed files', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      // Modify the graph (simulate re-parse)
      graph.removeFile('src/app.ts');
      graph.addNode({
        id: 'src/app.ts',
        type: 'file',
        name: 'app.ts',
        qualifiedName: 'src/app.ts',
        content: '',
        signature: '',
        location: { file: 'src/app.ts', startLine: 1, endLine: 100, startColumn: 0, endColumn: 0 },
        metadata: {},
      });
      graph.addNode({
        id: 'src/app.ts#main',
        type: 'function',
        name: 'main',
        qualifiedName: 'src/app.ts#main',
        content: 'function main() { /* updated */ }',
        signature: '() => void',
        location: { file: 'src/app.ts', startLine: 2, endLine: 5, startColumn: 0, endColumn: 1 },
        metadata: {},
      });

      const result = store.syncFiles(graph, ['src/app.ts'], [], projectDir);
      expect(result.chunksWritten).toBeGreaterThan(0);
    });

    it('should remove chunks for deleted files', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const mapBefore = store.readMap();
      expect(mapBefore.files['src/utils.ts']).toBeDefined();

      graph.removeFile('src/utils.ts');
      store.syncFiles(graph, [], ['src/utils.ts'], projectDir);

      const mapAfter = store.readMap();
      expect(mapAfter.files['src/utils.ts']).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove orphan chunk files', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      // Write an orphan chunk not referenced by map
      writeFileSync(join(storagePath, 'chunks', 'orphan1.json'), '{}');

      const deleted = store.cleanup();
      expect(deleted).toBe(1);
      expect(existsSync(join(storagePath, 'chunks', 'orphan1.json'))).toBe(false);
    });

    it('should not delete referenced chunks', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = buildTestGraph();
      store.saveGraph(graph, projectDir);

      const mapBefore = store.readMap();
      const chunkCountBefore = Object.keys(mapBefore.chunks).length;

      const deleted = store.cleanup();
      expect(deleted).toBe(0);

      const chunksDir = join(storagePath, 'chunks');
      const filesAfter = readdirSync(chunksDir);
      expect(filesAfter.length).toBe(chunkCountBefore);
    });
  });

  describe('Float32Array round-trip', () => {
    it('should preserve embeddings through save/load', () => {
      const store = new ChunkStore(storagePath);
      store.init(projectDir);

      const graph = new CodeGraph();
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      graph.addNode({
        id: 'test#emb',
        type: 'function',
        name: 'emb',
        qualifiedName: 'test#emb',
        content: 'function emb() {}',
        signature: '() => void',
        location: { file: 'test', startLine: 1, endLine: 1, startColumn: 0, endColumn: 0 },
        metadata: {},
        embedding,
      });

      store.saveGraph(graph, projectDir);
      const loaded = store.loadGraph();
      const node = loaded.getNode('test#emb');

      expect(node).toBeDefined();
      expect(node!.embedding).toBeInstanceOf(Float32Array);
      expect(node!.embedding!.length).toBe(4);
      expect(Math.abs(node!.embedding![0]! - 0.1)).toBeLessThan(0.001);
      expect(Math.abs(node!.embedding![3]! - 0.4)).toBeLessThan(0.001);
    });
  });
});
