#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { initProject, syncProject } from './indexer.js';
import { resolveStore } from '../storage/resolver.js';
import { startMcpServer } from '../mcp/server.js';

const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Argument parsing (no deps)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  path: string;
  global: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command = '';
  let path = '.';
  let global = false;
  let verbose = false;
  let help = false;
  let version = false;

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
    } else if (arg === '--path' || arg === '-p') {
      if (i + 1 < args.length) {
        path = args[++i]!;
      }
    } else if (!arg.startsWith('-') && !command) {
      command = arg;
    } else if (!arg.startsWith('-') && command) {
      path = arg;
    }
  }

  return { command, path, global, verbose, help, version };
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
kc-graph - Code intelligence graph for AI-optimized context retrieval

Usage:
  kc-graph <command> [path] [options]

Commands:
  init          Index a project and create the knowledge graph
  sync          Update an existing graph (re-index changed files, remove deleted)
  mcp           Start MCP stdio server (for AI agent integration)

Arguments:
  path          Project directory to index (default: current directory)

Options:
  -g, --global  Store graph in ~/.kc-graph/ instead of local .kc-graph/
  -V, --verbose Show each file being indexed
  -h, --help    Show this help message
  -v, --version Show version

Examples:
  kc-graph init                     Index current directory
  kc-graph init ./my-project        Index a specific project
  kc-graph init --global            Store in global ~/.kc-graph/
  kc-graph sync                     Update the graph for current directory
  kc-graph sync ./my-project        Update graph for a specific project
  kc-graph mcp                      Start MCP server for current project
  kc-graph mcp ./my-project         Start MCP server for a specific project
`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function runInit(args: ParsedArgs): Promise<void> {
  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`Error: directory not found: ${root}`);
    process.exit(1);
  }

  console.log(`Indexing ${root} ...`);
  const errors: string[] = [];

  const result = await initProject({
    root,
    global: args.global,
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
  const root = resolve(args.path);

  if (!existsSync(root)) {
    console.error(`Error: directory not found: ${root}`);
    process.exit(1);
  }

  console.log(`Syncing ${root} ...`);
  const errors: string[] = [];

  const result = await syncProject({
    root,
    global: args.global,
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
  console.log(`Done in ${(result.duration / 1000).toFixed(1)}s`);
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

async function runMcp(args: ParsedArgs): Promise<void> {
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

  // Load graph and start MCP server
  const graph = store.loadGraph();
  const meta = store.readMeta();

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write(
    `kc-graph MCP server started (${meta.stats.nodes} nodes, ${meta.stats.edges} edges)\n`,
  );

  startMcpServer(graph);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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
    case 'mcp':
    case 'serve':
      await runMcp(args);
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
