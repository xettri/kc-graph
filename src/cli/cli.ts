#!/usr/bin/env node

import { resolve, basename, dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { initProject, syncProject } from './indexer.js';
import {
  resolveStore,
  loadAllGlobalProjects,
  lazyLoadGlobalProjects,
  listGlobalProjects,
  listGlobalProjectsWithMeta,
  removeProject,
  getGlobalStoragePath,
} from '../storage/resolver.js';
import { startMcpServer } from '../mcp/server.js';
import { singleProject } from '../mcp/tools.js';
import { startViewer } from './viewer.js';
import { runWatch } from './watch.js';
import { runStatus, timeSince } from './status.js';
import { c } from './color.js';
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
  json: boolean;
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
  let json = false;
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
    } else if (arg === '--json') {
      json = true;
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
    json,
    subcommand,
  };
}

function printHelp(): void {
  const h = c.bold;
  const cmd = c.cyan;
  const opt = c.yellow;
  const dim = c.dim;

  console.log('');
  console.log(h('  kc-graph') + dim(' — code intelligence graph for AI context retrieval'));
  console.log('');
  console.log(h('  USAGE'));
  console.log(`    ${cmd('kc-graph')} ${dim('<command>')} [path] [options]`);
  console.log('');
  console.log(h('  COMMANDS'));
  console.log(`    ${cmd('init')}      Index a project and create the knowledge graph`);
  console.log(`    ${cmd('sync')}      Update graph (re-index changed files, remove deleted)`);
  console.log(`    ${cmd('watch')}     Watch for file changes and auto-sync`);
  console.log(`    ${cmd('status')}    Show graph health, staleness, and connectivity`);
  console.log(`    ${cmd('list')}      List indexed projects with stats`);
  console.log(`    ${cmd('view')}      Open interactive graph visualization in browser`);
  console.log(`    ${cmd('mcp')}       Start MCP stdio server for AI agent integration`);
  console.log(`    ${cmd('setup')}     Print MCP config snippet for Claude Code / Cursor`);
  console.log(`    ${cmd('remove')}    Remove indexed data and registry entry`);
  console.log(`    ${cmd('scope')}     Manage scoped environments`);
  console.log('');
  console.log(h('  OPTIONS'));
  console.log(
    `    ${opt('-g')}, ${opt('--global')}    Use global storage ${dim('(~/.kc-graph/)')}`,
  );
  console.log(
    `    ${opt('-s')}, ${opt('--scope')}     Use a named scope ${dim('(e.g., --scope feature-x)')}`,
  );
  console.log(
    `    ${opt('-f')}, ${opt('--force')}     Skip safety checks / confirm destructive ops`,
  );
  console.log(`    ${opt('--json')}          Output as JSON ${dim('(list, status)')}`);
  console.log(`    ${opt('--no-reload')}     Disable auto-reload in MCP server`);
  console.log(`    ${opt('-P')}, ${opt('--port')}      Port for viewer ${dim('(default: 4242)')}`);
  console.log(`    ${opt('-V')}, ${opt('--verbose')}   Show each file being indexed`);
  console.log(`    ${opt('-h')}, ${opt('--help')}      Show this help message`);
  console.log(`    ${opt('-v')}, ${opt('--version')}   Show version`);
  console.log('');
  console.log(h('  EXAMPLES'));
  console.log(
    `    ${dim('$')} kc-graph init                     ${dim('Index current directory')}`,
  );
  console.log(
    `    ${dim('$')} kc-graph init ./my-project -g     ${dim('Index and store globally')}`,
  );
  console.log(
    `    ${dim('$')} kc-graph sync --global            ${dim('Sync all global projects')}`,
  );
  console.log(
    `    ${dim('$')} kc-graph list --global            ${dim('Show all indexed projects')}`,
  );
  console.log(
    `    ${dim('$')} kc-graph mcp --global             ${dim('Start multi-project MCP server')}`,
  );
  console.log(
    `    ${dim('$')} kc-graph view                     ${dim('Open graph viewer in browser')}`,
  );
  console.log('');
  console.log(h('  SCOPES'));
  console.log(`    ${dim('$')} kc-graph scope                    ${dim('Show active scope')}`);
  console.log(
    `    ${dim('$')} kc-graph scope use ${opt('<name>')}         ${dim('Set active scope')}`,
  );
  console.log(`    ${dim('$')} kc-graph scope reset              ${dim('Reset to default')}`);
  console.log(`    ${dim('$')} kc-graph scope list               ${dim('List all scopes')}`);
  console.log(
    `    ${dim('$')} kc-graph scope delete ${opt('<name>')}      ${dim('Delete a scope')}`,
  );
  console.log('');
}

function scopePrefix(scope: string | undefined): string {
  const resolved = resolveScope(scope);
  return resolved !== 'default' ? c.dim(`[${resolved}] `) : '';
}

async function runInit(args: ParsedArgs): Promise<void> {
  const root = resolve(args.path);
  const prefix = scopePrefix(args.scope);

  if (!existsSync(root)) {
    console.error(`${prefix}${c.red('Error:')} directory not found: ${root}`);
    process.exit(1);
  }

  console.log(`${prefix}Indexing ${c.cyan(root)} ...`);
  const errors: string[] = [];

  const result = await initProject({
    root,
    global: args.global,
    scope: args.scope,
    onProgress: args.verbose
      ? (file, i, total) => {
          process.stdout.write(`\r  ${c.dim(`[${i}/${total}]`)} ${file}`);
          if (i === total) process.stdout.write('\n');
        }
      : (_, i, total) => {
          if (i % 50 === 0 || i === total) {
            process.stdout.write(`\r  Indexed ${c.bold(String(i))}/${total} files`);
            if (i === total) process.stdout.write('\n');
          }
        },
    onError: (file, err) => {
      errors.push(`${file}: ${err.message}`);
    },
  });

  console.log('');
  console.log(`${c.green('Done')} in ${c.bold((result.duration / 1000).toFixed(1) + 's')}`);
  console.log(`  ${c.bold(String(result.totalFiles))} files indexed`);
  console.log(`  ${result.totalNodes} nodes, ${result.totalEdges} edges`);
  console.log(`  ${result.totalChunks} chunks written`);
  console.log(`  Saved to ${c.dim(result.storagePath)}`);

  if (errors.length > 0) {
    console.log('');
    console.log(c.yellow(`Warnings (${errors.length} files failed to parse):`));
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${c.yellow('!')} ${err}`);
    }
    if (errors.length > 10) {
      console.log(c.dim(`  ... and ${errors.length - 10} more`));
    }
  }
}

async function runSync(args: ParsedArgs): Promise<void> {
  const prefix = scopePrefix(args.scope);

  if (args.global && args.path === '.') {
    const projects = listGlobalProjects(args.scope);
    if (projects.length === 0) {
      console.error(
        `${prefix}${c.red('No projects found.')} Run ${c.cyan('"kc-graph init --global"')} first.`,
      );
      process.exit(1);
    }

    console.log(`${prefix}Syncing ${c.bold(String(projects.length))} projects...`);
    let totalAdded = 0,
      totalUpdated = 0,
      totalRemoved = 0;

    for (const entry of projects) {
      if (!existsSync(entry.path)) {
        console.log(
          `${prefix}  ${c.cyan(entry.name)}: ${c.yellow('skipped')} ${c.dim('(directory not found)')}`,
        );
        continue;
      }
      try {
        const result = await syncProject({
          root: entry.path,
          global: true,
          scope: args.scope,
          force: args.force,
          onError: (file, err) => {
            if (args.verbose)
              console.error(`${prefix}  ${entry.name}: ${c.yellow(file)}: ${err.message}`);
          },
        });
        const parts: string[] = [];
        if (result.added > 0) parts.push(c.green(`+${result.added}`));
        if (result.updated > 0) parts.push(c.yellow(`~${result.updated}`));
        if (result.removed > 0) parts.push(c.red(`-${result.removed}`));
        const delta = parts.length > 0 ? parts.join(', ') : c.dim('up to date');
        console.log(`${prefix}  ${c.cyan(entry.name)}: ${delta}`);
        totalAdded += result.added;
        totalUpdated += result.updated;
        totalRemoved += result.removed;
      } catch (err) {
        console.error(
          `${prefix}  ${c.cyan(entry.name)}: ${c.red('error')} - ${(err as Error).message}`,
        );
      }
    }
    console.log(
      `${prefix}${c.green('Done.')} ${c.green(`+${totalAdded}`)} added, ${c.yellow(`~${totalUpdated}`)} updated, ${c.red(`-${totalRemoved}`)} removed`,
    );
    return;
  }

  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`${prefix}${c.red('Error:')} directory not found: ${root}`);
    process.exit(1);
  }

  console.log(`${prefix}Syncing ${c.cyan(root)} ...`);
  const errors: string[] = [];

  const result = await syncProject({
    root,
    global: args.global,
    scope: args.scope,
    force: args.force,
    onProgress: args.verbose
      ? (file, i, total) => {
          process.stdout.write(`\r  ${c.dim(`[${i}/${total}]`)} ${file}`);
          if (i === total) process.stdout.write('\n');
        }
      : (_, i, total) => {
          if (i % 50 === 0 || i === total) {
            process.stdout.write(`\r  Processed ${c.bold(String(i))}/${total} files`);
            if (i === total) process.stdout.write('\n');
          }
        },
    onError: (file, err) => {
      errors.push(`${file}: ${err.message}`);
    },
  });

  console.log('');
  console.log(
    `${prefix}${c.green('Done')} in ${c.bold((result.duration / 1000).toFixed(1) + 's')}`,
  );
  console.log(
    `  ${c.green(`+${result.added}`)} added, ${c.yellow(`~${result.updated}`)} updated, ${c.red(`-${result.removed}`)} removed`,
  );
  console.log(`  ${result.totalNodes} nodes, ${result.totalEdges} edges`);
  console.log(`  ${result.chunksWritten} chunks written, ${result.chunksDeleted} deleted`);
  console.log(`  Saved to ${c.dim(result.storagePath)}`);

  if (errors.length > 0) {
    console.log('');
    console.log(c.yellow(`Warnings (${errors.length} files failed to parse):`));
    for (const err of errors.slice(0, 10)) {
      console.log(`  ${c.yellow('!')} ${err}`);
    }
    if (errors.length > 10) {
      console.log(c.dim(`  ... and ${errors.length - 10} more`));
    }
  }
}

async function runView(args: ParsedArgs): Promise<void> {
  const prefix = scopePrefix(args.scope);

  if (args.global) {
    const projects = loadAllGlobalProjects(args.scope);
    if (projects.size === 0) {
      console.error(`${prefix}${c.red('No globally indexed projects found.')}`);
      process.exit(1);
    }
    startViewer(projects, { port: args.port });
    return;
  }

  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`${prefix}${c.red('Error:')} directory not found: ${root}`);
    process.exit(1);
  }

  const store = resolveStore(root, { global: false, scope: args.scope });

  if (!store.exists()) {
    console.error(`${c.red('No graph found for')} ${c.cyan(root)}`);
    console.error(`Run ${c.cyan('"kc-graph init"')} first to index the project.`);
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
      console.error(`${prefix}${c.red('No globally indexed projects found.')}`);
      console.error(`Index projects with: ${c.cyan('kc-graph init --global <path>')}`);
      process.exit(1);
    }

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
    console.error(`${prefix}${c.red('Error:')} directory not found: ${root}`);
    process.exit(1);
  }

  const store = resolveStore(root, { global: false, scope: args.scope });

  if (!store.exists()) {
    console.error(`${prefix}${c.red('No graph found for')} ${c.cyan(root)}`);
    console.error(`Run ${c.cyan('"kc-graph init"')} first to index the project.`);
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

function runList(args: ParsedArgs): void {
  const prefix = scopePrefix(args.scope);

  if (args.global) {
    const projects = listGlobalProjectsWithMeta(args.scope);
    if (projects.length === 0) {
      console.log(`${prefix}No globally indexed projects.`);
      return;
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          projects.map((p) => ({
            name: p.name,
            path: p.path,
            branch: p.branch ?? null,
            lastSync: p.lastSync,
            nodes: p.stats?.nodes ?? null,
            edges: p.stats?.edges ?? null,
            files: p.stats?.files ?? null,
          })),
          null,
          2,
        ),
      );
      return;
    }

    const rows = projects.map((p) => ({
      name: p.name,
      branch: p.branch || '-',
      files: String(p.stats?.files ?? '-'),
      nodes: String(p.stats?.nodes ?? '-'),
      edges: String(p.stats?.edges ?? '-'),
      synced: timeSince(p.lastSync),
    }));

    const cols = {
      name: Math.max(7, ...rows.map((r) => r.name.length)),
      branch: Math.max(6, ...rows.map((r) => r.branch.length)),
      files: Math.max(5, ...rows.map((r) => r.files.length)),
      nodes: Math.max(5, ...rows.map((r) => r.nodes.length)),
      edges: Math.max(5, ...rows.map((r) => r.edges.length)),
      synced: Math.max(6, ...rows.map((r) => r.synced.length)),
    };

    const header = c.bold(
      '  ' +
        'Project'.padEnd(cols.name) +
        '  ' +
        'Branch'.padEnd(cols.branch) +
        '  ' +
        'Files'.padStart(cols.files) +
        '  ' +
        'Nodes'.padStart(cols.nodes) +
        '  ' +
        'Edges'.padStart(cols.edges) +
        '  ' +
        'Synced'.padEnd(cols.synced),
    );

    const sep = c.dim(
      '  ' +
        '─'.repeat(
          cols.name + cols.branch + cols.files + cols.nodes + cols.edges + cols.synced + 10,
        ),
    );

    console.log('');
    console.log(header);
    console.log(sep);

    for (const r of rows) {
      console.log(
        '  ' +
          c.cyan(r.name.padEnd(cols.name)) +
          '  ' +
          c.yellow(r.branch.padEnd(cols.branch)) +
          '  ' +
          r.files.padStart(cols.files) +
          '  ' +
          r.nodes.padStart(cols.nodes) +
          '  ' +
          r.edges.padStart(cols.edges) +
          '  ' +
          c.dim(r.synced.padEnd(cols.synced)),
      );
    }

    console.log('');
    console.log(c.dim(`  ${projects.length} project(s)`));
    console.log('');
    return;
  }

  const root = resolve(args.path);
  const store = resolveStore(root, { global: false, scope: args.scope });

  if (!store.exists()) {
    console.log(`${prefix}No local index found at ${root}`);
    return;
  }

  const meta = store.readMeta();
  const name = basename(root);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          name,
          path: root,
          lastSync: meta.lastSync,
          nodes: meta.stats.nodes,
          edges: meta.stats.edges,
          files: meta.stats.files,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('');
  console.log(`  ${c.bold(c.cyan(name))}`);
  console.log(`  ${c.dim(root)}`);
  console.log(`  ${meta.stats.files} files, ${meta.stats.nodes} nodes, ${meta.stats.edges} edges`);
  console.log(`  ${c.dim('synced ' + timeSince(meta.lastSync))}`);
  console.log('');
}

function runRemove(args: ParsedArgs): void {
  const root = resolve(args.path);
  const prefix = scopePrefix(args.scope);

  if (!args.force) {
    const target = args.global
      ? `global project at ${c.cyan(root)}`
      : `local storage for ${c.cyan(root)}`;
    console.error(
      `${prefix}${c.yellow('This will permanently delete')} all indexed data for ${target}.`,
    );
    console.error(
      `Run with ${c.bold('--force')} to confirm: ${c.dim(`kc-graph remove${args.path !== '.' ? ' ' + args.path : ''}${args.global ? ' --global' : ''}${args.scope ? ' --scope ' + args.scope : ''} --force`)}`,
    );
    process.exit(1);
  }

  try {
    const { storagePath, name } = removeProject(root, {
      global: args.global,
      scope: args.scope,
    });
    console.log(`${prefix}${c.green('Removed')} ${c.cyan(name)} ${c.dim(`(${storagePath})`)}`);
  } catch (err) {
    console.error(`${prefix}${c.red('Error:')} ${(err as Error).message}`);
    process.exit(1);
  }
}

function runScope(args: ParsedArgs): void {
  const sub = args.subcommand;

  if (!sub) {
    console.log(`Active scope: ${c.cyan(getActiveScope())}`);
    return;
  }

  if (sub === 'use') {
    const name = args.path !== '.' ? args.path : undefined;
    if (!name || name === '.') {
      console.error(`Usage: kc-graph scope use ${c.yellow('<name>')}`);
      process.exit(1);
    }
    setActiveScope(name);
    console.log(`Active scope set to: ${c.cyan(name)}`);
    return;
  }

  if (sub === 'reset') {
    resetActiveScope();
    console.log(`Active scope reset to: ${c.cyan(DEFAULT_SCOPE)}`);
    return;
  }

  if (sub === 'list') {
    const scopes = listScopes(args.global);
    if (scopes.length === 0) {
      console.log('No scopes found.');
      return;
    }
    console.log(c.bold('  SCOPE'.padEnd(14) + 'PROJECTS'.padEnd(12) + 'LAST SYNC'));
    console.log(c.dim('  ' + '─'.repeat(32)));
    for (const scope of scopes) {
      const marker = scope.active ? c.green('* ') : '  ';
      const name = (scope.active ? c.cyan(scope.name) : scope.name).padEnd(
        scope.active ? 12 + 9 : 12,
      ); // ANSI codes add length
      const count = String(scope.projectCount).padEnd(10);
      const sync = scope.lastSync > 0 ? c.dim(timeSince(scope.lastSync)) : c.dim('never');
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
      console.error(
        `${c.yellow('This will permanently delete')} scope '${c.cyan(name)}' and all its indexed data.`,
      );
      console.error(
        `Run with ${c.bold('--force')} to confirm: ${c.dim(`kc-graph scope delete ${name}${args.global ? ' --global' : ''} --force`)}`,
      );
      process.exit(1);
    }
    deleteScope(name, args.global);
    console.log(`${c.green('Deleted')} scope '${c.cyan(name)}'.`);
    return;
  }

  console.error(`${c.red('Unknown scope subcommand:')} ${sub}`);
  console.error(
    `Available: ${c.cyan('use')}, ${c.cyan('reset')}, ${c.cyan('list')}, ${c.cyan('delete')}`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.version) {
    console.log(`${c.bold('kc-graph')} ${c.dim('v' + VERSION)}`);
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
    case 'list':
    case 'ls':
      runList(args);
      break;
    case 'remove':
      runRemove(args);
      break;
    case 'scope':
      runScope(args);
      break;
    default:
      console.error(`${c.red('Unknown command:')} ${args.command}`);
      console.error(`Run ${c.cyan('"kc-graph --help"')} for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
