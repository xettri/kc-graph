import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { ChunkStore } from './chunk-store.js';
import type { CodeGraph } from '../core/graph.js';
import type { GlobalRegistry, RegistryEntry, StorageConfig } from './types.js';
import {
  scopePath,
  ensureScopeDir,
  resolveScope as resolveScopeFromConfig,
  detectGitBranch,
} from './scope.js';

const REGISTRY_FILE = 'registry.json';

/**
 * Resolve the correct storage location for a project.
 *
 * Priority:
 * 1. Local: <projectRoot>/.kc-graph/<scope>/
 * 2. Global: ~/.kc-graph/<scope>/projects/<projectId>/
 */
export function resolveStore(
  projectRoot: string,
  options?: { global?: boolean; scope?: string; config?: Partial<StorageConfig> },
): ChunkStore {
  const root = resolve(projectRoot);
  const scope = resolveScopeFromConfig(options?.scope);

  if (options?.global) {
    return getGlobalStore(root, scope, options.config);
  }

  // Check local first
  const localPath = scopePath(scope, false, root);
  if (existsSync(join(localPath, 'meta.json'))) {
    return new ChunkStore(localPath, options?.config);
  }

  // Check global
  const globalStore = findGlobalStore(root, scope);
  if (globalStore) {
    return globalStore;
  }

  // Default: create local
  return new ChunkStore(localPath, options?.config);
}

/**
 * Create a store for a project. Respects the --global and --scope flags.
 */
export function createStore(
  projectRoot: string,
  options?: { global?: boolean; scope?: string; config?: Partial<StorageConfig> },
): ChunkStore {
  const root = resolve(projectRoot);
  const scope = resolveScopeFromConfig(options?.scope);

  if (options?.global) {
    return getGlobalStore(root, scope, options.config);
  }

  const localPath = scopePath(scope, false, root);
  return new ChunkStore(localPath, options?.config);
}

// ---------------------------------------------------------------------------
// Global registry (scope-aware)
// ---------------------------------------------------------------------------

function getGlobalStore(
  projectRoot: string,
  scope: string,
  config?: Partial<StorageConfig>,
): ChunkStore {
  const scopeDir = ensureScopeDir(scope, true);
  const projectId = getProjectId(projectRoot);
  const projectDir = join(scopeDir, 'projects', projectId);

  // Detect git branch for safety
  const branch = detectGitBranch(projectRoot);

  // Update registry
  const registry = readRegistry(scopeDir);
  registry.projects[projectId] = {
    path: projectRoot,
    name: basename(projectRoot),
    lastSync: Date.now(),
    branch: branch ?? null,
  };
  writeRegistry(scopeDir, registry);

  return new ChunkStore(projectDir, config);
}

function findGlobalStore(projectRoot: string, scope: string): ChunkStore | null {
  const scopeDir = scopePath(scope, true);
  const registryPath = join(scopeDir, REGISTRY_FILE);
  if (!existsSync(registryPath)) return null;

  const registry = readRegistry(scopeDir);

  for (const [projectId, entry] of Object.entries(registry.projects)) {
    if (resolve(entry.path) === resolve(projectRoot)) {
      const storePath = join(scopeDir, 'projects', projectId);
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

function readRegistry(scopeDir: string): GlobalRegistry {
  const path = join(scopeDir, REGISTRY_FILE);
  if (!existsSync(path)) return { projects: {} };
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeRegistry(scopeDir: string, registry: GlobalRegistry): void {
  mkdirSync(scopeDir, { recursive: true });
  const path = join(scopeDir, REGISTRY_FILE);
  writeFileSync(path, JSON.stringify(registry, null, 2));
}

// ---------------------------------------------------------------------------
// Utility: list all globally tracked projects (scope-aware)
// ---------------------------------------------------------------------------

export function listGlobalProjects(scope?: string): RegistryEntry[] {
  const resolvedScope = resolveScopeFromConfig(scope);
  const scopeDir = scopePath(resolvedScope, true);
  const registry = readRegistry(scopeDir);
  return Object.values(registry.projects);
}

export function loadAllGlobalProjects(
  scope?: string,
): Map<string, { graph: CodeGraph; store: ChunkStore; path: string }> {
  const resolvedScope = resolveScopeFromConfig(scope);
  const scopeDir = scopePath(resolvedScope, true);
  const registry = readRegistry(scopeDir);
  const result = new Map<string, { graph: CodeGraph; store: ChunkStore; path: string }>();

  for (const [projectId, entry] of Object.entries(registry.projects)) {
    const storePath = join(scopeDir, 'projects', projectId);
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

export function getGlobalStoragePath(scope?: string): string {
  const resolvedScope = resolveScopeFromConfig(scope);
  return scopePath(resolvedScope, true);
}
