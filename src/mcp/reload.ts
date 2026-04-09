import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ChunkStore } from '../storage/chunk-store.js';
import type { ProjectMap } from './tools.js';

interface StoreState {
  storagePath: string;
  lastMtime: number;
}

/**
 * Check meta.json mtime per project before each tool call.
 * If changed, reload that project's graph from disk.
 */
export function createRefresher(projects: ProjectMap, storePaths: Map<string, string>): () => void {
  const states = new Map<string, StoreState>();

  for (const [name, storagePath] of storePaths) {
    try {
      const mtime = statSync(join(storagePath, 'meta.json')).mtimeMs;
      states.set(name, { storagePath, lastMtime: mtime });
    } catch {
      states.set(name, { storagePath, lastMtime: 0 });
    }
  }

  return function refresh() {
    for (const [name, state] of states) {
      try {
        const mtime = statSync(join(state.storagePath, 'meta.json')).mtimeMs;
        if (mtime === state.lastMtime) continue;

        const store = new ChunkStore(state.storagePath);
        if (!store.exists()) continue;

        const graph = store.loadGraph();
        const existing = projects.get(name);
        if (existing) {
          projects.set(name, { graph, path: existing.path });
          state.lastMtime = mtime;
          process.stderr.write(
            `[reload] ${name}: ${graph.nodeCount} nodes, ${graph.edgeCount} edges\n`,
          );
        }
      } catch {
        // skip
      }
    }
  };
}
