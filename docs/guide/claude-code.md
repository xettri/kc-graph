# Claude Code Integration

kc-graph is designed to work seamlessly with AI coding assistants like Claude Code. Here's how to set it up.

## Overview

Instead of the AI reading entire files to understand your code, kc-graph provides a pre-built knowledge graph that the AI can query. This:

- Reduces token usage by 60-90%
- Gives the AI better understanding of code relationships
- Enables impact analysis before making changes
- Provides semantic search across the codebase

## Setup as MCP Server

### 1. Index Your Project

Create a script to index your codebase:

```typescript
// scripts/index-project.ts
import { CodeGraph, indexSourceFile, indexDocFile, saveToFile } from 'kc-graph';
import { readFileSync } from 'fs';
import { globSync } from 'fs';

const graph = new CodeGraph();

// Index source files
for (const file of globSync('src/**/*.{ts,tsx,js,jsx}')) {
  indexSourceFile(graph, file, readFileSync(file, 'utf-8'));
}

// Index docs
for (const file of globSync('{docs,*.md}/**/*.md')) {
  indexDocFile(graph, file, readFileSync(file, 'utf-8'));
}

await saveToFile(graph, '.kc-graph.json');
console.log(`Indexed: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`);
```

### 2. Create MCP Server

```typescript
// mcp-server.ts
import { CodeGraph, loadFromFile, createToolHandlers, toolDefinitions } from 'kc-graph';

// Load the pre-built graph
const graph = await loadFromFile('.kc-graph.json');
const handlers = createToolHandlers(graph);

// Register tools with your MCP server framework
// The exact setup depends on your MCP server implementation
for (const [name, schema] of Object.entries(toolDefinitions)) {
  server.registerTool(schema, (args) => handlers[name](args));
}
```

### 3. Available MCP Tools

| Tool | Description | Input |
|------|-------------|-------|
| `search_code` | Find functions, classes, variables | `{ query, type?, file? }` |
| `get_context` | Token-optimized context for a symbol | `{ symbol, file?, maxTokens? }` |
| `get_impact` | Change impact analysis | `{ symbol, file?, maxDepth? }` |
| `get_structure` | File structure overview | `{ path }` |
| `find_similar` | Find semantically similar code | `{ symbol, file?, limit? }` |

## Example AI Workflow

### Code Review

1. AI receives a diff
2. AI calls `get_impact` for each changed function
3. AI gets a clear picture of what else might break
4. AI provides targeted review comments

### Code Generation

1. User asks to add a feature
2. AI calls `search_code` to find related existing code
3. AI calls `get_context` to understand the surrounding code
4. AI calls `get_structure` to see where to add the new code
5. AI generates code that fits the existing patterns

### Bug Investigation

1. User reports a bug in function X
2. AI calls `get_context` for function X with high token budget
3. AI follows `calls` and `references` edges via impact analysis
4. AI traces the bug to its root cause through the graph

## Keeping the Graph Updated

Re-index when files change. Add this to your workflow:

```bash
# Re-index on file save (using a file watcher)
npx tsx scripts/index-project.ts
```

Or integrate incremental updates:

```typescript
import { indexSourceFile, loadFromFile, saveToFile } from 'kc-graph';

const graph = await loadFromFile('.kc-graph.json');

// Only re-index changed files
for (const changedFile of getChangedFiles()) {
  indexSourceFile(graph, changedFile, readFileSync(changedFile, 'utf-8'));
}

await saveToFile(graph, '.kc-graph.json');
```
