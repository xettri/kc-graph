import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { ScopeMeta, ScopeInfo, UserConfig } from './types.js';

export const DEFAULT_SCOPE = 'default';

const SCOPE_PATTERN = /^[a-z][a-z0-9-]{0,49}$/;
const GLOBAL_ROOT = join(homedir(), '.kc-graph');
const LOCAL_DIR = '.kc-graph';

/**
 * Validate a scope name.
 * Must start with a lowercase letter, contain only lowercase alphanumeric and hyphens, max 50 chars.
 */
export function validateScopeName(name: string): void {
  if (!SCOPE_PATTERN.test(name)) {
    throw new Error(
      `Invalid scope name '${name}'. Use lowercase letters, numbers, and hyphens (e.g., 'my-scope').`,
    );
  }
}

/**
 * Get the base path for a scope's storage.
 *
 * Global: ~/.kc-graph/<scope>/
 * Local:  <projectRoot>/.kc-graph/<scope>/
 */
export function scopePath(scope: string, global: boolean, projectRoot?: string): string {
  if (global) {
    return join(getGlobalRoot(), scope);
  }
  if (!projectRoot) {
    throw new Error('projectRoot is required for local scope path');
  }
  return join(projectRoot, LOCAL_DIR, scope);
}

/**
 * Get the global root directory.
 * Supports KC_GRAPH_HOME env override for testing.
 */
export function getGlobalRoot(): string {
  return process.env.KC_GRAPH_HOME ?? GLOBAL_ROOT;
}

const CONFIG_FILE = 'config.json';

function readUserConfig(): UserConfig {
  const configPath = join(getGlobalRoot(), CONFIG_FILE);
  if (!existsSync(configPath)) return { activeScope: DEFAULT_SCOPE };
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return { activeScope: DEFAULT_SCOPE };
  }
}

function writeUserConfig(config: UserConfig): void {
  const root = getGlobalRoot();
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify(config, null, 2));
}

/** Get the currently active scope from config.json. */
export function getActiveScope(): string {
  const config = readUserConfig();
  try {
    validateScopeName(config.activeScope);
    return config.activeScope;
  } catch {
    return DEFAULT_SCOPE;
  }
}

/** Set the active scope. Validates the name first. */
export function setActiveScope(scope: string): void {
  validateScopeName(scope);
  const config = readUserConfig();
  config.activeScope = scope;
  writeUserConfig(config);
}

/** Reset the active scope to default. */
export function resetActiveScope(): void {
  const config = readUserConfig();
  config.activeScope = DEFAULT_SCOPE;
  writeUserConfig(config);
}

/**
 * Resolve which scope to use.
 * Priority: explicit flag > KC_GRAPH_SCOPE env > config.json > "default"
 */
export function resolveScope(explicit?: string): string {
  if (explicit) {
    validateScopeName(explicit);
    return explicit;
  }

  const envScope = process.env.KC_GRAPH_SCOPE;
  if (envScope) {
    validateScopeName(envScope);
    return envScope;
  }

  return getActiveScope();
}

/**
 * Ensure a scope directory exists with scope.json.
 * Creates the directory and scope.json if they don't exist. Idempotent.
 */
export function ensureScopeDir(scope: string, global: boolean, projectRoot?: string): string {
  validateScopeName(scope);
  const dir = scopePath(scope, global, projectRoot);
  mkdirSync(dir, { recursive: true });

  const metaPath = join(dir, 'scope.json');
  if (!existsSync(metaPath)) {
    const meta: ScopeMeta = { name: scope, createdAt: Date.now() };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  return dir;
}

/** Check if a scope directory exists. */
export function scopeExists(scope: string, global: boolean, projectRoot?: string): boolean {
  const dir = scopePath(scope, global, projectRoot);
  return existsSync(join(dir, 'scope.json'));
}

/** List all scopes in global or local storage. */
export function listScopes(global: boolean, projectRoot?: string): ScopeInfo[] {
  const root = global ? getGlobalRoot() : join(projectRoot ?? process.cwd(), '.kc-graph');
  if (!existsSync(root)) return [];

  const activeScope = getActiveScope();
  const scopes: ScopeInfo[] = [];

  for (const entry of readdirSync(root)) {
    const entryPath = join(root, entry);
    const metaPath = join(entryPath, 'scope.json');

    try {
      if (!statSync(entryPath).isDirectory()) continue;
      if (!existsSync(metaPath)) continue;
    } catch {
      continue;
    }

    const meta: ScopeMeta = JSON.parse(readFileSync(metaPath, 'utf-8'));

    let projectCount = 0;
    let lastSync = 0;
    const registryPath = join(entryPath, 'registry.json');
    if (existsSync(registryPath)) {
      try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
        const projects = Object.values(registry.projects ?? {}) as Array<{ lastSync: number }>;
        projectCount = projects.length;
        for (const p of projects) {
          if (p.lastSync > lastSync) lastSync = p.lastSync;
        }
      } catch {
        // skip corrupt registry
      }
    }

    scopes.push({
      name: meta.name,
      projectCount,
      lastSync,
      createdAt: meta.createdAt,
      active: meta.name === activeScope,
    });
  }

  return scopes;
}

/** Delete a scope. Cannot delete "default". */
export function deleteScope(scope: string, global: boolean, projectRoot?: string): void {
  if (scope === DEFAULT_SCOPE) {
    throw new Error(`Cannot delete the '${DEFAULT_SCOPE}' scope.`);
  }

  if (!scopeExists(scope, global, projectRoot)) {
    throw new Error(`Scope '${scope}' does not exist.`);
  }

  const dir = scopePath(scope, global, projectRoot);
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Detect the current git branch for the given directory.
 * Returns null if not a git repo or branch cannot be determined.
 */
export function detectGitBranch(dir: string): string | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}
