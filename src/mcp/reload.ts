import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChunkStore } from '../storage/chunk-store.js';
import type { CodeGraph } from '../core/graph.js';
import type { ProjectMap } from './tools.js';
import type { GlobalRegistry } from '../storage/types.js';

interface StoreState {
  storagePath: string;
  lastMtime: number;
}

/**
 * Check registry and meta.json mtimes before each tool call.
 * Detects new projects, removed projects, and updated graphs.
 * New/updated projects use lazy loading — graph is loaded on first access.
 */
export function createRefresher(projects: ProjectMap, scopeDir: string): () => void {
  const states = new Map<string, StoreState>();
  let lastRegistryMtime = 0;

  const registryPath = join(scopeDir, 'registry.json');

  function lazyEntry(
    store: ChunkStore,
    path: string,
  ): { graph: CodeGraph; path: string; stats?: { nodes: number; edges: number; files: number } } {
    let cached: CodeGraph | null = null;
    let stats: { nodes: number; edges: number; files: number } | undefined;
    try {
      const meta = store.readMeta();
      stats = { nodes: meta.stats.nodes, edges: meta.stats.edges, files: meta.stats.files };
    } catch {}
    return {
      path,
      stats,
      get graph(): CodeGraph {
        if (!cached) {
          cached = store.loadGraph();
        }
        return cached;
      },
    };
  }

  function syncFromRegistry() {
    if (!existsSync(registryPath)) return;

    let registry: GlobalRegistry;
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    } catch {
      return;
    }

    const registryNames = new Set<string>();

    for (const [projectId, entry] of Object.entries(registry.projects)) {
      registryNames.add(entry.name);
      const storagePath = join(scopeDir, 'projects', projectId);

      if (!states.has(entry.name)) {
        // New project — register lazily
        try {
          const store = new ChunkStore(storagePath);
          if (!store.exists()) continue;
          const mtime = statSync(join(storagePath, 'meta.json')).mtimeMs;
          projects.set(entry.name, lazyEntry(store, entry.path));
          states.set(entry.name, { storagePath, lastMtime: mtime });
          process.stderr.write(`[reload] +${entry.name}\n`);
        } catch {
          // skip
        }
      }
    }

    // Remove projects no longer in registry
    for (const name of [...states.keys()]) {
      if (!registryNames.has(name)) {
        states.delete(name);
        projects.delete(name);
        process.stderr.write(`[reload] -${name}: removed\n`);
      }
    }
  }

  // Seed initial state
  for (const [name] of projects) {
    if (existsSync(registryPath)) {
      try {
        const registry: GlobalRegistry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        for (const [projectId, regEntry] of Object.entries(registry.projects)) {
          if (regEntry.name === name) {
            const storagePath = join(scopeDir, 'projects', projectId);
            try {
              const mtime = statSync(join(storagePath, 'meta.json')).mtimeMs;
              states.set(name, { storagePath, lastMtime: mtime });
            } catch {
              states.set(name, { storagePath, lastMtime: 0 });
            }
            break;
          }
        }
      } catch {
        // skip
      }
    }
  }

  try {
    lastRegistryMtime = statSync(registryPath).mtimeMs;
  } catch {
    // no registry yet
  }

  return function refresh() {
    // Check if registry changed (new/removed projects)
    try {
      const regMtime = statSync(registryPath).mtimeMs;
      if (regMtime !== lastRegistryMtime) {
        lastRegistryMtime = regMtime;
        syncFromRegistry();
      }
    } catch {
      // no registry
    }

    // Check existing projects for graph updates — replace with fresh lazy entry
    for (const [name, state] of states) {
      try {
        const mtime = statSync(join(state.storagePath, 'meta.json')).mtimeMs;
        if (mtime === state.lastMtime) continue;

        const store = new ChunkStore(state.storagePath);
        if (!store.exists()) continue;

        const existing = projects.get(name);
        if (existing) {
          projects.set(name, lazyEntry(store, existing.path));
          state.lastMtime = mtime;
          process.stderr.write(`[reload] ${name}: updated\n`);
        }
      } catch {
        // skip
      }
    }
  };
}
