import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodeGraph } from '../core/graph.js';
import { indexSourceFile } from '../parser/typescript-parser.js';
import { indexDocFile } from '../parser/doc-parser.js';
import { saveToFile, loadFromFile } from '../serialization/snapshot.js';
import { discoverFiles, type DiscoverOptions } from './discover.js';

const GRAPH_FILE = '.kc-graph.json';

export interface IndexResult {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  sourceFiles: number;
  docFiles: number;
  duration: number;
  graphPath: string;
}

export interface IndexOptions extends DiscoverOptions {
  /** Path to save the graph (default: .kc-graph.json in project root). */
  output?: string;
  /** Show progress for each file. */
  onProgress?: (file: string, index: number, total: number) => void;
  /** Called when a file fails to parse. */
  onError?: (file: string, error: Error) => void;
}

/**
 * Index a project from scratch.
 * Discovers all files, parses them, and saves the graph.
 */
export async function initProject(options: IndexOptions = {}): Promise<IndexResult> {
  const root = resolve(options.root ?? process.cwd());
  const graphPath = options.output ?? resolve(root, GRAPH_FILE);
  const start = performance.now();

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

  await saveToFile(graph, graphPath);
  const duration = performance.now() - start;

  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    fileCount: sourceFiles + docFiles,
    sourceFiles,
    docFiles,
    duration,
    graphPath,
  };
}

/**
 * Sync/update an existing graph.
 * Loads the graph, discovers files, re-indexes changed/new files,
 * removes nodes for deleted files, and saves.
 */
export async function syncProject(options: IndexOptions = {}): Promise<IndexResult & { added: number; updated: number; removed: number }> {
  const root = resolve(options.root ?? process.cwd());
  const graphPath = options.output ?? resolve(root, GRAPH_FILE);
  const start = performance.now();

  // Load existing graph or create new one
  let graph: CodeGraph;
  let existingFiles: Set<string>;

  if (existsSync(graphPath)) {
    graph = await loadFromFile(graphPath);
    existingFiles = new Set(graph.getFiles());
  } else {
    graph = new CodeGraph();
    existingFiles = new Set();
  }

  const discoveredFiles = discoverFiles({ ...options, root });
  const discoveredPaths = new Set(discoveredFiles.map((f) => f.relativePath));

  let added = 0;
  let updated = 0;
  let removed = 0;
  let sourceFiles = 0;
  let docFiles = 0;

  // Remove nodes for files that no longer exist
  for (const existingFile of existingFiles) {
    if (!discoveredPaths.has(existingFile)) {
      graph.removeFile(existingFile);
      removed++;
    }
  }

  // Index new and changed files
  for (let i = 0; i < discoveredFiles.length; i++) {
    const file = discoveredFiles[i]!;
    options.onProgress?.(file.relativePath, i + 1, discoveredFiles.length);

    const isExisting = existingFiles.has(file.relativePath);

    // Check if file was modified (compare content hash would be ideal,
    // but for simplicity we re-index all discovered files on sync)
    try {
      const content = readFileSync(file.absolutePath, 'utf-8');

      if (file.kind === 'source') {
        // removeFile is called inside indexSourceFile for incremental re-index
        indexSourceFile(graph, file.relativePath, content);
        sourceFiles++;
      } else if (file.kind === 'doc') {
        // Remove old doc nodes first
        graph.removeFile(file.relativePath);
        indexDocFile(graph, file.relativePath, content);
        docFiles++;
      }

      if (isExisting) {
        updated++;
      } else {
        added++;
      }
    } catch (err) {
      options.onError?.(file.relativePath, err as Error);
    }
  }

  await saveToFile(graph, graphPath);
  const duration = performance.now() - start;

  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    fileCount: sourceFiles + docFiles,
    sourceFiles,
    docFiles,
    duration,
    graphPath,
    added,
    updated,
    removed,
  };
}
