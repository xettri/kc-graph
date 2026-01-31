import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { ChunkStore } from './chunk-store.js';
import type { CodeGraph } from '../core/graph.js';
import type { GlobalRegistry, RegistryEntry, StorageConfig } from './types.js';

const LOCAL_DIR = '.kc-graph';
const GLOBAL_DIR = join(homedir(), '.kc-graph');
const REGISTRY_FILE = 'registry.json';

/**
 * Resolve the correct storage location for a project.
 *
 * Priority:
 * 1. Local: <projectRoot>/.kc-graph/
 * 2. Global: ~/.kc-graph/projects/<projectId>/
 */
export function resolveStore(
  projectRoot: string,
  options?: { global?: boolean; config?: Partial<StorageConfig> },
): ChunkStore {
  const root = resolve(projectRoot);

  if (options?.global) {
    return getGlobalStore(root, options.config);
  }

  // Check local first
  const localPath = join(root, LOCAL_DIR);
  if (existsSync(join(localPath, 'meta.json'))) {
    return new ChunkStore(localPath, options?.config);
  }

  // Check global
  const globalStore = findGlobalStore(root);
  if (globalStore) {
    return globalStore;
  }

  // Default: create local
  return new ChunkStore(localPath, options?.config);
}

/**
 * Create a store for a project. Respects the --global flag.
 */
export function createStore(
  projectRoot: string,
  options?: { global?: boolean; config?: Partial<StorageConfig> },
): ChunkStore {
  const root = resolve(projectRoot);

  if (options?.global) {
    return getGlobalStore(root, options.config);
  }

  const localPath = join(root, LOCAL_DIR);
  return new ChunkStore(localPath, options?.config);
}

// ---------------------------------------------------------------------------
// Global registry
// ---------------------------------------------------------------------------

function getGlobalStore(projectRoot: string, config?: Partial<StorageConfig>): ChunkStore {
  ensureGlobalDir();
  const projectId = getProjectId(projectRoot);
  const projectDir = join(GLOBAL_DIR, 'projects', projectId);

  // Update registry
  const registry = readRegistry();
  registry.projects[projectId] = {
    path: projectRoot,
    name: basename(projectRoot),
    lastSync: Date.now(),
  };
  writeRegistry(registry);

  return new ChunkStore(projectDir, config);
}

function findGlobalStore(projectRoot: string): ChunkStore | null {
  const registryPath = join(GLOBAL_DIR, REGISTRY_FILE);
  if (!existsSync(registryPath)) return null;

  const registry = readRegistry();

  // Find by matching project path
  for (const [projectId, entry] of Object.entries(registry.projects)) {
    if (resolve(entry.path) === resolve(projectRoot)) {
      const storePath = join(GLOBAL_DIR, 'projects', projectId);
      if (existsSync(join(storePath, 'meta.json'))) {
        return new ChunkStore(storePath);
      }
    }
  }

  return null;
}

/** Generate a short deterministic project ID from its path. */
function getProjectId(projectRoot: string): string {
  return createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 8);
}

function ensureGlobalDir(): void {
  mkdirSync(join(GLOBAL_DIR, 'projects'), { recursive: true });
}

function readRegistry(): GlobalRegistry {
  const path = join(GLOBAL_DIR, REGISTRY_FILE);
  if (!existsSync(path)) return { projects: {} };
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeRegistry(registry: GlobalRegistry): void {
  const path = join(GLOBAL_DIR, REGISTRY_FILE);
  writeFileSync(path, JSON.stringify(registry, null, 2));
}

// ---------------------------------------------------------------------------
// Utility: list all globally tracked projects
// ---------------------------------------------------------------------------

export function listGlobalProjects(): RegistryEntry[] {
  const registry = readRegistry();
  return Object.values(registry.projects);
}

export function loadAllGlobalProjects(): Map<
  string,
  { graph: CodeGraph; store: ChunkStore; path: string }
> {
  const registry = readRegistry();
  const result = new Map<string, { graph: CodeGraph; store: ChunkStore; path: string }>();

  for (const [projectId, entry] of Object.entries(registry.projects)) {
    const storePath = join(GLOBAL_DIR, 'projects', projectId);
    try {
      const store = new ChunkStore(storePath);
      if (!store.exists()) continue;
      const graph = store.loadGraph();
      result.set(entry.name, { graph, store, path: entry.path });
    } catch {
      // Skip corrupt/unreadable projects
    }
  }

  return result;
}

export function getGlobalStoragePath(): string {
  return GLOBAL_DIR;
}
