import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodeGraph } from '../core/graph.js';
import { indexSourceFile } from '../parser/typescript-parser.js';
import { indexDocFile } from '../parser/doc-parser.js';
import { createStore, resolveStore } from './resolver.js';
import { discoverFiles } from '../cli/discover.js';
import type { DiscoverOptions } from '../cli/discover.js';
import type { StorageConfig, SyncResult } from './types.js';

export interface IndexOptions extends DiscoverOptions {
  /** Use global storage (~/.kc-graph/) instead of local .kc-graph/. */
  global?: boolean;
  /** Storage config overrides. */
  config?: Partial<StorageConfig>;
  /** Show progress for each file. */
  onProgress?: (file: string, index: number, total: number) => void;
  /** Called when a file fails to parse. */
  onError?: (file: string, error: Error) => void;
}

/**
 * Index a project from scratch.
 * Discovers all files, parses them, and saves to chunked storage.
 */
export async function initProject(options: IndexOptions = {}): Promise<SyncResult> {
  const root = resolve(options.root ?? process.cwd());
  const start = performance.now();

  // Create storage
  const store = createStore(root, { global: options.global, config: options.config });

  if (store.exists()) {
    throw new Error(
      `Storage already exists at ${store.storagePath}. Use "sync" to update, or delete the .kc-graph directory.`,
    );
  }

  store.init(root);

  // Build the graph
  const graph = new CodeGraph();
  const files = discoverFiles({ ...options, root });

  let sourceFiles = 0;
  let docFiles = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    options.onProgress?.(file.relativePath, i + 1, files.length);

    try {
      const content = readFileSync(file.absolutePath, 'utf-8');

      if (file.kind === 'source') {
        indexSourceFile(graph, file.relativePath, content);
        sourceFiles++;
      } else if (file.kind === 'doc') {
        indexDocFile(graph, file.relativePath, content);
        docFiles++;
      }
    } catch (err) {
      options.onError?.(file.relativePath, err as Error);
    }
  }

  // Save to chunked storage
  store.saveGraph(graph, root);

  const duration = performance.now() - start;
  const meta = store.readMeta();

  return {
    added: sourceFiles + docFiles,
    updated: 0,
    removed: 0,
    chunksWritten: meta.stats.chunks,
    chunksDeleted: 0,
    totalNodes: graph.nodeCount,
    totalEdges: graph.edgeCount,
    totalFiles: sourceFiles + docFiles,
    totalChunks: meta.stats.chunks,
    duration,
    storagePath: store.storagePath,
  };
}

/**
 * Sync/update an existing graph.
 * Compares file mtimes, only re-parses changed/new files,
 * removes deleted, rewrites only affected chunks.
 */
export async function syncProject(options: IndexOptions = {}): Promise<SyncResult> {
  const root = resolve(options.root ?? process.cwd());
  const start = performance.now();

  // Resolve existing storage
  const store = resolveStore(root, { global: options.global, config: options.config });

  if (!store.exists()) {
    throw new Error(`No existing storage found. Run "kc-graph init" first.`);
  }

  const map = store.readMap();
  const discoveredFiles = discoverFiles({ ...options, root });

  // Classify files
  const discoveredPaths = new Set(discoveredFiles.map((f) => f.relativePath));
  const changedFiles: string[] = [];
  const newFiles: string[] = [];
  const deletedFiles: string[] = [];

  // Find changed and new files
  for (const file of discoveredFiles) {
    const existing = map.files[file.relativePath];
    if (!existing) {
      newFiles.push(file.relativePath);
    } else {
      // Check mtime
      try {
        const stat = statSync(file.absolutePath);
        const currentMtime = Math.floor(stat.mtimeMs);
        if (currentMtime !== existing.mtime) {
          changedFiles.push(file.relativePath);
        }
      } catch {
        changedFiles.push(file.relativePath);
      }
    }
  }

  // Find deleted files
  for (const filePath of Object.keys(map.files)) {
    if (!discoveredPaths.has(filePath)) {
      deletedFiles.push(filePath);
    }
  }

  // If nothing changed, short-circuit — read meta once to avoid double file I/O
  if (changedFiles.length === 0 && newFiles.length === 0 && deletedFiles.length === 0) {
    const meta = store.readMeta();
    return {
      added: 0,
      updated: 0,
      removed: 0,
      chunksWritten: 0,
      chunksDeleted: 0,
      totalNodes: meta.stats.nodes,
      totalEdges: meta.stats.edges,
      totalFiles: Object.keys(map.files).length,
      totalChunks: Object.keys(map.chunks).length,
      duration: performance.now() - start,
      storagePath: store.storagePath,
    };
  }

  // Load full graph, apply changes, save affected chunks
  const graph = store.loadGraph();
  const filesToReindex = [...changedFiles, ...newFiles];
  const total = filesToReindex.length;

  // Build a Map for O(1) lookup instead of O(n) .find() per file
  const discoveredByPath = new Map(discoveredFiles.map((f) => [f.relativePath, f]));

  for (let i = 0; i < filesToReindex.length; i++) {
    const relPath = filesToReindex[i]!;
    const discovered = discoveredByPath.get(relPath);
    if (!discovered) continue;

    options.onProgress?.(relPath, i + 1, total);

    try {
      const content = readFileSync(discovered.absolutePath, 'utf-8');

      if (discovered.kind === 'source') {
        indexSourceFile(graph, relPath, content); // handles removeFile internally
      } else if (discovered.kind === 'doc') {
        graph.removeFile(relPath);
        indexDocFile(graph, relPath, content);
      }
    } catch (err) {
      options.onError?.(relPath, err as Error);
    }
  }

  // Remove deleted files from graph
  for (const file of deletedFiles) {
    graph.removeFile(file);
  }

  // Re-save affected chunks
  const { chunksWritten, chunksDeleted } = store.syncFiles(
    graph,
    filesToReindex,
    deletedFiles,
    root,
  );

  // Update meta
  const updatedMap = store.readMap();
  store.writeMeta({
    version: '2.0',
    config: store.readMeta().config,
    project: root,
    lastSync: Date.now(),
    stats: {
      files: Object.keys(updatedMap.files).length,
      nodes: graph.nodeCount,
      edges: graph.edgeCount,
      chunks: Object.keys(updatedMap.chunks).length,
    },
  });

  // Cleanup orphan chunks
  store.cleanup();

  const duration = performance.now() - start;

  return {
    added: newFiles.length,
    updated: changedFiles.length,
    removed: deletedFiles.length,
    chunksWritten,
    chunksDeleted,
    totalNodes: graph.nodeCount,
    totalEdges: graph.edgeCount,
    totalFiles: Object.keys(updatedMap.files).length,
    totalChunks: Object.keys(updatedMap.chunks).length,
    duration,
    storagePath: store.storagePath,
  };
}
