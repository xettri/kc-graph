#!/usr/bin/env node

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { initProject, syncProject } from './indexer.js';

const VERSION = '0.1.0';
const GRAPH_FILE = '.kc-graph.json';

// ---------------------------------------------------------------------------
// Argument parsing (no deps)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  path: string;
  output: string | undefined;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command = '';
  let path = '.';
  let output: string | undefined;
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
    } else if ((arg === '--output' || arg === '-o') && i + 1 < args.length) {
      output = args[++i];
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

  return { command, path, output, verbose, help, version };
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

Arguments:
  path          Project directory to index (default: current directory)

Options:
  -o, --output  Path to save the graph file (default: <path>/.kc-graph.json)
  -V, --verbose Show each file being indexed
  -h, --help    Show this help message
  -v, --version Show version

Examples:
  kc-graph init                     Index current directory
  kc-graph init ./my-project        Index a specific project
  kc-graph sync                     Update the graph for current directory
  kc-graph sync ./my-project        Update graph for a specific project
  kc-graph init -o graph.json .     Custom output path
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

  const graphPath = args.output ?? resolve(root, GRAPH_FILE);
  if (existsSync(graphPath)) {
    console.log(`Graph already exists at ${graphPath}`);
    console.log('Use "kc-graph sync" to update, or delete the file and re-run init.');
    process.exit(1);
  }

  console.log(`Indexing ${root} ...`);
  const errors: string[] = [];

  const result = await initProject({
    root,
    output: graphPath,
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
  console.log(`  ${result.sourceFiles} source files`);
  console.log(`  ${result.docFiles} doc files`);
  console.log(`  ${result.nodeCount} nodes, ${result.edgeCount} edges`);
  console.log(`  Saved to ${result.graphPath}`);

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

  const graphPath = args.output ?? resolve(root, GRAPH_FILE);

  if (!existsSync(graphPath)) {
    console.log(`No existing graph found at ${graphPath}`);
    console.log('Run "kc-graph init" first to create the graph.');
    process.exit(1);
  }

  console.log(`Syncing ${root} ...`);
  const errors: string[] = [];

  const result = await syncProject({
    root,
    output: graphPath,
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
  console.log(`  ${result.nodeCount} nodes, ${result.edgeCount} edges`);
  console.log(`  Saved to ${result.graphPath}`);

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
