# kc-graph

**AI-optimized code intelligence graph** — maps codebases at module/function/variable level for token-efficient AI context retrieval.

[![CI](https://github.com/xettri/kc-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/xettri/kc-graph/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why kc-graph?

AI coding assistants waste tokens reading entire files to understand code. `kc-graph` builds a **graph-based knowledge centre** that maps your codebase at the symbol level, so AI agents get exactly the context they need — nothing more.

- **Impact Analysis** — "If I change function X, what else breaks?"
- **Call Graph Extraction** — Traces function calls, arrow functions, method invocations
- **Token-Optimized Context** — Extract the most relevant code within a token budget
- **Symbol-Level Graph** — Functions, classes, variables, types, and their relationships
- **Semantic Search** — Find similar code using embedding vectors
- **MCP Server** — Built-in stdio server for AI agent integration (`kc-graph mcp`)
- **Chunked Storage** — Size-based splitting for large codebases, local or global
- **Zero Runtime Dependencies** — Only TypeScript as an optional peer dep for parsing

## Install

```bash
npm install kc-graph
```

For global CLI access:

```bash
npm install -g kc-graph
```

## CLI

```bash
# Index a project (creates .kc-graph/ directory with chunked storage)
kc-graph init

# Index a specific directory
kc-graph init ./my-project

# Store graph globally (~/.kc-graph/) instead of locally
kc-graph init --global

# Update an existing graph (only re-indexes changed files)
kc-graph sync

# Start MCP server for AI agents (Claude Code, etc.)
kc-graph mcp

# Verbose mode (shows each file)
kc-graph init -V
```

The CLI:
- Automatically discovers `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts` source files
- Extracts **function calls**, **arrow functions**, **class methods**, **constructors**
- Resolves relative imports (`./utils` → `src/utils.ts`)
- Indexes `.md` documentation files and links them to code symbols
- Respects `.gitignore` rules with symlink cycle detection
- Skips binary files, `node_modules`, `dist`, `build`, and other non-source directories
- Skips files larger than 1MB

## MCP Server

The fastest way to give AI agents deep codebase understanding:

```bash
# 1. Index your project
kc-graph init

# 2. Start MCP server (stdio JSON-RPC)
kc-graph mcp
```

Configure in your AI client (e.g. Claude Code `settings.json`):

```json
{
  "mcpServers": {
    "kc-graph": {
      "command": "kc-graph",
      "args": ["mcp"]
    }
  }
}
```

The server exposes 5 tools:

| Tool | Description |
|------|-------------|
| `search_code` | Find functions, classes, variables by name/pattern |
| `get_context` | Token-optimized context for a symbol or file |
| `get_impact` | What breaks if you change this symbol? |
| `get_structure` | File structure — classes, functions, exports |
| `find_similar` | Semantically similar code (requires embeddings) |

## Quick Start

```typescript
import { CodeGraph, indexSourceFile, buildContext, analyzeImpact } from 'kc-graph';

// Create a graph
const graph = new CodeGraph();

// Index a source file (requires TypeScript as peer dep)
const source = `
export const greet = (name: string): string => {
  return format(name);
};

function format(name: string): string {
  return name.trim().toUpperCase();
}
`;

indexSourceFile(graph, 'src/greet.ts', source);

// Query the graph — arrow functions are extracted too
const greetFn = graph.resolve('greet');
console.log(greetFn?.signature);
// → "const greet = (name: string): string"

// Call edges are extracted automatically
const edges = [...graph.allEdges()].filter(e => e.type === 'calls');
// → greet calls format

// Get AI-optimized context (respects token budget)
const context = buildContext(graph, [greetFn!.id], {
  maxTokens: 2000,
  includeSignatures: true,
  includeDoc: true,
  depth: 3,
});
console.log(context.context);

// Analyze change impact
const impact = analyzeImpact(graph, greetFn!.id);
console.log(`Changing greet() impacts ${impact.stats.totalImpacted} symbols`);
```

## Storage

kc-graph uses **chunked file storage** for efficient persistence:

```bash
.kc-graph/
├── meta.json          # Version, config, stats
├── map.json           # File → chunk mapping
└── chunks/
    ├── a1b2c3.json    # Chunk with nodes + edges
    ├── d4e5f6.json
    └── ...
```

- Files are grouped by directory, split by size (default 256KB chunks)
- Only changed chunks are rewritten during sync
- Chunk IDs are opaque short hex UUIDs
- Local `.kc-graph/` takes priority over global `~/.kc-graph/`

### Programmatic Storage API

```typescript
import { initProject, syncProject, resolveStore, ChunkStore } from 'kc-graph';

// Index a project (same as CLI `kc-graph init`)
const result = await initProject({
  root: '/path/to/project',
  onProgress: (file, i, total) => console.log(`${i}/${total}: ${file}`),
});

// Sync changes (same as CLI `kc-graph sync`)
const syncResult = await syncProject({ root: '/path/to/project' });

// Low-level: load graph from storage
const store = resolveStore('/path/to/project');
const graph = store.loadGraph();
```

## Parser Features

The TypeScript parser extracts:

| Feature | Edge Type |
|---------|-----------|
| Function declarations | `contains`, `exports` |
| Arrow functions (`const fn = () => {}`) | `contains`, `exports` |
| Function expressions | `contains`, `exports` |
| Class declarations + methods | `contains`, `exports` |
| Constructors | `contains` |
| Arrow class properties (`handler = () => {}`) | `contains` |
| Function calls within bodies | `calls` |
| `new` expressions | `calls` |
| Import declarations | `imports` |
| Named imports (`import { X }`) | `imports` (to `file#X`) |
| Relative import resolution | `./foo` → `dir/foo.ts` |
| Re-exports (`export { x } from './mod'`) | `imports` + `exports` |
| Heritage clauses | `extends`, `implements` |
| Variables and constants | `contains`, `exports` |
| Interfaces and type aliases | `contains`, `exports` |

## API

### Graph Operations

```typescript
// Create and query
const graph = new CodeGraph();
graph.addNode({ type: 'function', name: 'foo', qualifiedName: 'src/main.ts#foo' });
graph.addNode({ type: 'function', name: 'bar', qualifiedName: 'src/main.ts#bar' });
graph.addEdge({ source: 'src/main.ts#foo', target: 'src/main.ts#bar', type: 'calls' });

// Find nodes
graph.findByName('foo');           // case-insensitive search
graph.findByFile('src/main.ts');   // all nodes in a file
graph.findByType('function');      // all functions
graph.resolve('foo');              // smart resolve by name/ID/qualified name

// Chainable queries
import { query } from 'kc-graph';
query(graph)
  .ofType('function')
  .inFile('src/auth.ts')
  .withName(/^handle/)
  .results();

// Traversal
import { bfs, dfs } from 'kc-graph';
for (const { node, depth } of bfs(graph, 'src/main.ts#foo', { maxDepth: 3 })) {
  console.log(`${node.name} at depth ${depth}`);
}
```

### Impact Analysis

```typescript
import { analyzeImpact, formatImpactSummary } from 'kc-graph';

const result = analyzeImpact(graph, 'utils.ts#validate', {
  maxDepth: 5,
  direction: 'dependents',  // who depends on this?
});

console.log(formatImpactSummary(result));
// Impact analysis for: validate (function)
// Total impacted: 12 nodes across 4 files
//   src/auth.ts:
//     login (function) - distance: 1, via: calls
//   src/api.ts:
//     handleRequest (function) - distance: 2, via: calls → calls
```

### AI Context Builder

```typescript
import { buildContext, getContextForSymbol } from 'kc-graph';

// Get context for a symbol (consumer-friendly)
const ctx = getContextForSymbol(graph, 'login', {
  maxTokens: 4000,
  includeSignatures: true,
  includeDoc: true,
});

// Returns: { context: string, estimatedTokens: number, files: string[], nodes: CodeNode[] }
```

### Embedding Search

```typescript
import { setEmbedding, findSimilar, cosineSimilarity } from 'kc-graph';

// Set embeddings (from your preferred embedding model)
setEmbedding(graph, 'login', new Float32Array([0.1, 0.2, ...]));

// Find similar code
const results = findSimilar(graph, queryEmbedding, 10, 0.5);
// → [{ node: CodeNode, score: 0.95 }, ...]
```

## Performance

kc-graph is built with V8 engine optimizations in mind:

- **Monomorphic object shapes** — all nodes share one hidden class for optimal inline caching
- **Map-based adjacency** — O(1) for all lookups, faster than plain objects for dynamic keys
- **Float32Array embeddings** — 4x less memory than `number[]`, SIMD-eligible
- **Generator-based traversals** — lazy evaluation, never materializes full result sets
- **Array-backed BFS queue** — avoids `shift()` O(n) cost with head pointer
- **Loop-unrolled cosine similarity** — 4 elements per iteration for better ILP
- **Chunked storage** — size-based splitting, only rewrites affected chunks on sync
- **Atomic writes** — write-to-temp + rename prevents corruption on crash

## License

MIT
