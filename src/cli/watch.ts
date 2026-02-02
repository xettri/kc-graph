import { resolve } from 'node:path';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { syncProject } from '../storage/indexer.js';
import { resolveStore } from '../storage/resolver.js';

export interface WatchOptions {
  root?: string;
  global?: boolean;
  debounceMs?: number;
  verbose?: boolean;
  onSync?: (result: { added: number; updated: number; removed: number; duration: number }) => void;
  onError?: (error: Error) => void;
}

/**
 * Watch a project directory for file changes and auto-sync the graph.
 *
 * Uses Node.js fs.watch with recursive mode. Changes are debounced
 * to avoid redundant syncs during rapid edits (e.g. save-all).
 */
export function startWatch(options: WatchOptions = {}): { close: () => void } {
  const root = resolve(options.root ?? process.cwd());
  const debounceMs = options.debounceMs ?? 500;
  const global = options.global ?? false;

  const store = resolveStore(root, { global });
  if (!store.exists()) {
    throw new Error(`No graph found for ${root}. Run "kc-graph init" first.`);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let pendingSync = false;

  const runSync = async (): Promise<void> => {
    if (syncing) {
      pendingSync = true;
      return;
    }

    syncing = true;
    try {
      const result = await syncProject({
        root,
        global,
        onError: (file, err) => {
          options.onError?.(new Error(`${file}: ${err.message}`));
        },
      });

      if (result.added > 0 || result.updated > 0 || result.removed > 0) {
        options.onSync?.({
          added: result.added,
          updated: result.updated,
          removed: result.removed,
          duration: result.duration,
        });
      }
    } catch (err) {
      options.onError?.(err as Error);
    } finally {
      syncing = false;
      if (pendingSync) {
        pendingSync = false;
        runSync();
      }
    }
  };

  const scheduleSync = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runSync();
    }, debounceMs);
  };

  // Skip common non-source directories and files
  const shouldIgnore = (filename: string): boolean => {
    if (!filename) return true;
    const parts = filename.split('/');
    for (const part of parts) {
      if (
        part === 'node_modules' ||
        part === '.git' ||
        part === '.kc-graph' ||
        part === 'dist' ||
        part === 'build' ||
        part === 'coverage' ||
        part === '.next' ||
        part === '.nuxt'
      ) {
        return true;
      }
    }
    return false;
  };

  let watcher: ReturnType<typeof watch>;
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (filename && !shouldIgnore(filename)) {
        scheduleSync();
      }
    });
  } catch {
    // Fallback for platforms without recursive watch support
    watcher = watch(root, {}, (_event, filename) => {
      if (filename && !shouldIgnore(filename)) {
        scheduleSync();
      }
    });
  }

  return {
    close: () => {
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
    },
  };
}

/**
 * CLI entry point for `kc-graph watch`.
 */
export async function runWatch(args: {
  path: string;
  global: boolean;
  verbose: boolean;
}): Promise<void> {
  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`Error: directory not found: ${root}`);
    process.exit(1);
  }

  const store = resolveStore(root, { global: args.global });
  if (!store.exists()) {
    console.error(`No graph found for ${root}`);
    console.error('Run "kc-graph init" first to index the project.');
    process.exit(1);
  }

  console.log(`Watching ${root} for changes...`);
  console.log('Press Ctrl+C to stop.\n');

  const { close } = startWatch({
    root,
    global: args.global,
    verbose: args.verbose,
    onSync: (result) => {
      const parts: string[] = [];
      if (result.added > 0) parts.push(`+${result.added} added`);
      if (result.updated > 0) parts.push(`~${result.updated} updated`);
      if (result.removed > 0) parts.push(`-${result.removed} removed`);
      const time = (result.duration / 1000).toFixed(1);
      console.log(`[sync] ${parts.join(', ')} (${time}s)`);
    },
    onError: (err) => {
      console.error(`[error] ${err.message}`);
    },
  });

  // Keep process alive and handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping watcher...');
    close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    close();
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {});
}
