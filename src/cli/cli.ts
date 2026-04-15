#!/usr/bin/env node

import { resolve, basename, dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { initProject, syncProject } from './indexer.js';
import {
  resolveStore,
  loadAllGlobalProjects,
  lazyLoadGlobalProjects,
  listGlobalProjects,
  removeProject,
  getGlobalStoragePath,
} from '../storage/resolver.js';
import { startMcpServer } from '../mcp/server.js';
import { singleProject } from '../mcp/tools.js';
import { startViewer } from './viewer.js';
import { runWatch } from './watch.js';
import { runStatus, timeSince } from './status.js';
import {
  resolveScope,
  getActiveScope,
  setActiveScope,
  resetActiveScope,
  listScopes,
  deleteScope,
  DEFAULT_SCOPE,
} from '../storage/scope.js';

function getVersion(): string {
  let curr = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

  while (curr !== '/' && curr !== '') {
    const pkgPath = join(curr, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) return pkg.version;
    }
    curr = dirname(curr);
  }
  return 'unknown';
}

const VERSION = getVersion();

interface ParsedArgs {
  command: string;
  path: string;
  global: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
  port: number;
  scope: string | undefined;
  force: boolean;
  noReload: boolean;
  subcommand: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command = '';
  let path = '.';
  let global = false;
  let verbose = false;
  let help = false;
  let version = false;
  let port = 4242;
  let scope: string | undefined;
  let force = false;
  let noReload = false;
  let subcommand: string | undefined;

  let positionalCount = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version' || arg === '-v') {
      version = true;
    } else if (arg === '--verbose' || arg === '-V') {
      verbose = true;
    } else if (arg === '--global' || arg === '-g') {
      global = true;
    } else if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--no-reload') {
      noReload = true;
    } else if (arg === '--scope' || arg === '-s') {
      if (i + 1 < args.length) {
        scope = args[++i]!;
      }
    } else if (arg === '--port' || arg === '-P') {
      if (i + 1 < args.length) {
        port = parseInt(args[++i]!, 10) || 4242;
      }
    } else if (arg === '--path' || arg === '-p') {
      if (i + 1 < args.length) {
        path = args[++i]!;
      }
    } else if (!arg.startsWith('-')) {
      if (positionalCount === 0) {
        command = arg;
      } else if (positionalCount === 1) {
        if (command === 'scope') {
          subcommand = arg;
        } else {
          path = arg;
        }
      } else if (positionalCount === 2) {
        path = arg;
      }
      positionalCount++;
    }
  }

  return {
    command,
    path,
    global,
    verbose,
    help,
    version,
    port,
    scope,
    force,
    noReload,
    subcommand,
  };
}

function printHelp(): void {
  console.log(`
kc-graph - Code intelligence graph for AI-optimized context retrieval

Usage:
  kc-graph <command> [path] [options]

Commands:
  init          Index a project and create the knowledge graph
  sync          Update an existing graph (re-index changed files, remove deleted)
  watch         Watch for file changes and auto-sync the graph
  status        Show project graph status, staleness, and health metrics
  view          Open interactive graph visualization in browser
  mcp           Start MCP stdio server (for AI agent integration)
  remove        Remove a project's indexed data and registry entry
  setup         Print MCP config snippet for Claude Code / Cursor
  scope         Manage scoped environments (use, reset, list, delete)

Arguments:
  path          Project directory to index (default: current directory)

Options:
  -g, --global  Store graph in ~/.kc-graph/ instead of local .kc-graph/
                For mcp: load all globally registered projects
  -s, --scope   Use a named scope (e.g., --scope feature-x)
  -f, --force   Skip branch safety check on sync / confirm destructive ops
  --no-reload   Disable auto-reload in MCP server (static mode)
  -P, --port    Port for the viewer server (default: 4242)
  -V, --verbose Show each file being indexed
  -h, --help    Show this help message
  -v, --version Show version

Examples:
  kc-graph init                     Index current directory
  kc-graph init ./my-project -g     Index and store globally
  kc-graph sync                     Update the graph for current directory
  kc-graph sync --global            Sync all globally registered projects
  kc-graph sync --force             Sync even if branch has changed
  kc-graph watch                    Watch for changes and auto-sync
  kc-graph status                   Show graph health and staleness
  kc-graph view                     Open graph viewer in browser
  kc-graph mcp                      Start MCP server for current project
  kc-graph mcp --global             Start MCP server for all global projects
  kc-graph setup                    Show MCP config for Claude Code

Scope management:
  kc-graph scope                    Show active scope
  kc-graph scope use <name>         Set the active scope
  kc-graph scope reset              Reset to default scope
  kc-graph scope list [--global]    List all scopes
  kc-graph scope delete <name>      Delete a scope
  kc-graph init -g -s feature-x     Index into a named scope
`);
}

function scopePrefix(scope: string | undefined): string {
  const resolved = resolveScope(scope);
  return resolved !== 'default' ? `[scope: ${resolved}] ` : '';
}

async function runInit(args: ParsedArgs): Promise<void> {
  const root = resolve(args.path);
  const prefix = scopePrefix(args.scope);

  if (!existsSync(root)) {
    console.error(`${prefix}Error: directory not found: ${root}`);
    process.exit(1);
  }

  console.log(`${prefix}Indexing ${root} ...`);
  const errors: string[] = [];

  const result = await initProject({
    root,
    global: args.global,
    scope: args.scope,
    onProgress: args.verbose
      ? (file, i, total) => {
          process.stdout.write(`\r  [${i}/${total}] ${file}`);
          if (i === total) process.stdout.write('\n');
        }
      : (_, i, total) => {
          if (i % 50 === 0 || i === total) {
            process.stdout.write(`\r  Indexed ${i}/${total} files`);
            if (i === total) process.stdout.write('\n');
          }
        },
    onError: (file, err) => {
      errors.push(`${file}: ${err.message}`);
    },
  });

  console.log('');
  console.log(`Done in ${(result.duration / 1000).toFixed(1)}s`);
  console.log(`  ${result.totalFiles} files indexed`);
  console.log(`  ${result.totalNodes} nodes, ${result.totalEdges} edges`);
  console.log(`  ${result.totalChunks} chunks written`);
  console.log(`  Saved to ${result.storagePath}`);

  if (errors.length > 0) {
    console.log('');
    console.log(`Warnings (${errors.length} files failed to parse):`);
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${err}`);
    }
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
  }
}

async function runSync(args: ParsedArgs): Promise<void> {
  const prefix = scopePrefix(args.scope);

  if (args.global && args.path === '.') {
    const projects = listGlobalProjects(args.scope);
    if (projects.length === 0) {
      console.error(`${prefix}No projects found in scope. Run "kc-graph init --global" first.`);
      process.exit(1);
    }

    console.log(`${prefix}Syncing ${projects.length} projects...`);
    let totalAdded = 0,
      totalUpdated = 0,
      totalRemoved = 0;

    for (const entry of projects) {
      if (!existsSync(entry.path)) {
        console.log(`${prefix}  ${entry.name}: skipped (directory not found)`);
        continue;
      }
      try {
        const result = await syncProject({
          root: entry.path,
          global: true,
          scope: args.scope,
          force: args.force,
          onError: (file, err) => {
            if (args.verbose) console.error(`${prefix}  ${entry.name}: ${file}: ${err.message}`);
          },
        });
        const parts: string[] = [];
        if (result.added > 0) parts.push(`+${result.added}`);
        if (result.updated > 0) parts.push(`~${result.updated}`);
        if (result.removed > 0) parts.push(`-${result.removed}`);
        const delta = parts.length > 0 ? parts.join(', ') : 'up to date';
        console.log(`${prefix}  ${entry.name}: ${delta}`);
        totalAdded += result.added;
        totalUpdated += result.updated;
        totalRemoved += result.removed;
      } catch (err) {
        console.error(`${prefix}  ${entry.name}: error - ${(err as Error).message}`);
      }
    }
    console.log(
      `${prefix}Done. +${totalAdded} added, ~${totalUpdated} updated, -${totalRemoved} removed`,
    );
    return;
  }

  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`${prefix}Error: directory not found: ${root}`);
    process.exit(1);
  }

  console.log(`${prefix}Syncing ${root} ...`);
  const errors: string[] = [];

  const result = await syncProject({
    root,
    global: args.global,
    scope: args.scope,
    force: args.force,
    onProgress: args.verbose
      ? (file, i, total) => {
          process.stdout.write(`\r  [${i}/${total}] ${file}`);
          if (i === total) process.stdout.write('\n');
        }
      : (_, i, total) => {
          if (i % 50 === 0 || i === total) {
            process.stdout.write(`\r  Processed ${i}/${total} files`);
            if (i === total) process.stdout.write('\n');
          }
        },
    onError: (file, err) => {
      errors.push(`${file}: ${err.message}`);
    },
  });

  console.log('');
  console.log(`${prefix}Done in ${(result.duration / 1000).toFixed(1)}s`);
  console.log(`  +${result.added} added, ~${result.updated} updated, -${result.removed} removed`);
  console.log(`  ${result.totalNodes} nodes, ${result.totalEdges} edges`);
  console.log(`  ${result.chunksWritten} chunks written, ${result.chunksDeleted} deleted`);
  console.log(`  Saved to ${result.storagePath}`);

  if (errors.length > 0) {
    console.log('');
    console.log(`Warnings (${errors.length} files failed to parse):`);
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${err}`);
    }
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
  }
}

async function runView(args: ParsedArgs): Promise<void> {
  const prefix = scopePrefix(args.scope);

  if (args.global) {
    const projects = loadAllGlobalProjects(args.scope);
    if (projects.size === 0) {
      console.error(`${prefix}No globally indexed projects found.`);
      process.exit(1);
    }
    startViewer(projects, { port: args.port });
    return;
  }

  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`${prefix}Error: directory not found: ${root}`);
    process.exit(1);
  }

  const store = resolveStore(root, { global: false, scope: args.scope });

  if (!store.exists()) {
    console.error(`No graph found for ${root}`);
    console.error('Run "kc-graph init" first to index the project.');
    process.exit(1);
  }

  const graph = store.loadGraph();
  startViewer(graph, { port: args.port });
}

async function runMcp(args: ParsedArgs): Promise<void> {
  const prefix = scopePrefix(args.scope);

  if (args.global) {
    const projects = lazyLoadGlobalProjects(args.scope);

    if (projects.size === 0) {
      console.error(`${prefix}No globally indexed projects found.`);
      console.error('Index projects with: kc-graph init --global <path>');
      process.exit(1);
    }

    // Log project names from registry without loading graphs
    const registered = listGlobalProjects(args.scope);
    for (const entry of registered) {
      process.stderr.write(`${prefix}  ${entry.name}\n`);
    }

    process.stderr.write(
      `${prefix}kc-graph MCP server started — ${projects.size} projects (lazy loading)\n`,
    );

    startMcpServer(projects, {
      scope: args.scope,
      scopeDir: args.noReload ? undefined : getGlobalStoragePath(args.scope),
    });
    return;
  }

  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`${prefix}Error: directory not found: ${root}`);
    process.exit(1);
  }

  const store = resolveStore(root, { global: false, scope: args.scope });

  if (!store.exists()) {
    console.error(`${prefix}No graph found for ${root}`);
    console.error('Run "kc-graph init" first to index the project.');
    process.exit(1);
  }

  const graph = store.loadGraph();
  const meta = store.readMeta();
  const name = basename(root);

  process.stderr.write(
    `${prefix}kc-graph MCP server started — ${name} (${meta.stats.nodes} nodes, ${meta.stats.edges} edges)\n`,
  );

  startMcpServer(singleProject(name, graph, root), { scope: args.scope });
}

function runSetup(args: ParsedArgs): void {
  const scope = args.scope;
  const mcpArgs = scope ? '["mcp", "--global", "--scope", "' + scope + '"]' : '["mcp", "--global"]';
  const prefix = scopePrefix(args.scope);

  console.log(`
${prefix}Add the following to your MCP client config:

  Claude Code  ~/.claude/settings.json
  Cursor       .cursor/mcp.json

{
  "mcpServers": {
    "kc-graph": {
      "command": "kc-graph",
      "args": ${mcpArgs}
    }
  }
}

For a single project, replace "--global" with the project path:

  "args": ["mcp", "/path/to/project"${scope ? ', "--scope", "' + scope + '"' : ''}]

Quick start:

  kc-graph init --global${scope ? ' --scope ' + scope : ''} ~/work/project-a
  kc-graph init --global${scope ? ' --scope ' + scope : ''} ~/work/project-b
  kc-graph setup${scope ? ' --scope ' + scope : ''}
`);
}

function runRemove(args: ParsedArgs): void {
  const root = resolve(args.path);
  const prefix = scopePrefix(args.scope);

  if (!args.force) {
    const target = args.global ? `global project at ${root}` : `local storage for ${root}`;
    console.error(`${prefix}This will permanently delete all indexed data for ${target}.`);
    console.error(
      `Run with --force to confirm: kc-graph remove${args.path !== '.' ? ' ' + args.path : ''}${args.global ? ' --global' : ''}${args.scope ? ' --scope ' + args.scope : ''} --force`,
    );
    process.exit(1);
  }

  try {
    const { storagePath, name } = removeProject(root, {
      global: args.global,
      scope: args.scope,
    });
    console.log(`${prefix}Removed ${name} (${storagePath})`);
  } catch (err) {
    console.error(`${prefix}${(err as Error).message}`);
    process.exit(1);
  }
}

function runScope(args: ParsedArgs): void {
  const sub = args.subcommand;

  if (!sub) {
    console.log(`Active scope: ${getActiveScope()}`);
    return;
  }

  if (sub === 'use') {
    const name = args.path !== '.' ? args.path : undefined;
    if (!name || name === '.') {
      console.error('Usage: kc-graph scope use <name>');
      process.exit(1);
    }
    setActiveScope(name);
    console.log(`Active scope set to: ${name}`);
    return;
  }

  if (sub === 'reset') {
    resetActiveScope();
    console.log(`Active scope reset to: ${DEFAULT_SCOPE}`);
    return;
  }

  if (sub === 'list') {
    const scopes = listScopes(args.global);
    if (scopes.length === 0) {
      console.log('No scopes found.');
      return;
    }
    console.log('  SCOPE'.padEnd(14) + 'PROJECTS'.padEnd(12) + 'LAST SYNC');
    for (const scope of scopes) {
      const marker = scope.active ? '* ' : '  ';
      const name = scope.name.padEnd(12);
      const count = String(scope.projectCount).padEnd(10);
      const sync = scope.lastSync > 0 ? timeSince(scope.lastSync) : 'never';
      console.log(`${marker}${name}${count}${sync}`);
    }
    return;
  }

  if (sub === 'delete') {
    const name = args.path !== '.' ? args.path : undefined;
    if (!name || name === '.') {
      console.error('Usage: kc-graph scope delete <name> [--global] [--force]');
      process.exit(1);
    }
    if (!args.force) {
      console.error(`This will permanently delete scope '${name}' and all its indexed data.`);
      console.error(
        `Run with --force to confirm: kc-graph scope delete ${name}${args.global ? ' --global' : ''} --force`,
      );
      process.exit(1);
    }
    deleteScope(name, args.global);
    console.log(`Scope '${name}' deleted.`);
    return;
  }

  console.error(`Unknown scope subcommand: ${sub}`);
  console.error('Available: use, reset, list, delete');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.version) {
    console.log(`kc-graph v${VERSION}`);
    return;
  }

  if (args.help || !args.command) {
    printHelp();
    return;
  }

  switch (args.command) {
    case 'init':
      await runInit(args);
      break;
    case 'sync':
    case 'update':
      await runSync(args);
      break;
    case 'watch':
      await runWatch({
        path: args.path,
        global: args.global,
        verbose: args.verbose,
        scope: args.scope,
      });
      break;
    case 'status':
      runStatus({ path: args.path, global: args.global, scope: args.scope });
      break;
    case 'view':
      await runView(args);
      break;
    case 'mcp':
    case 'serve':
      await runMcp(args);
      break;
    case 'setup':
      runSetup(args);
      break;
    case 'remove':
      runRemove(args);
      break;
    case 'scope':
      runScope(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      console.error('Run "kc-graph --help" for usage.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
