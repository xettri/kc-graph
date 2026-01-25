# kc-graph

**AI-optimized code intelligence graph** — maps codebases at module/function/variable level for token-efficient AI context retrieval.

[![CI](https://github.com/xettri/kc-graph/actions/workflows/ci.yml/badge.svg)](https://github.com/xettri/kc-graph/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why kc-graph?

AI coding assistants waste tokens reading entire files to understand code. `kc-graph` builds a **graph-based knowledge centre** that maps your codebase at the symbol level, so AI agents get exactly the context they need — nothing more.

- **Impact Analysis** — "If I change function X, what else breaks?"
- **Token-Optimized Context** — Extract the most relevant code within a token budget
- **Symbol-Level Graph** — Functions, classes, variables, types, and their relationships
- **Semantic Search** — Find similar code using embedding vectors
- **MCP Integration** — Ready-to-use tool definitions for AI agent frameworks
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

Index any project from the command line:

```bash
# Index a project (creates .kc-graph.json)
kc-graph init

# Index a specific directory
kc-graph init ./my-project

# Update an existing graph (re-indexes changed files, removes deleted ones)
kc-graph sync

# Verbose mode (shows each file)
kc-graph init -V

# Custom output path
kc-graph init -o graph.json ./my-project
```

The CLI:
- Automatically discovers `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts` source files
- Indexes `.md` documentation files and links them to code symbols
- Respects `.gitignore` rules
- Skips binary files, `node_modules`, `dist`, `build`, and other non-source directories
- Skips files larger than 1MB

## Quick Start

```typescript
import { CodeGraph, indexSourceFile, buildContext, analyzeImpact } from 'kc-graph';

// Create a graph
const graph = new CodeGraph();

// Index a source file (requires TypeScript as peer dep)
const source = `
export function login(user: string, pass: string): Token {
  const valid = validate(user, pass);
  return generateToken(user);
}

function validate(user: string, pass: string): boolean {
  return user.length > 0 && pass.length > 8;
}

function generateToken(user: string): Token {
  return { token: crypto.randomUUID(), user };
}
`;

indexSourceFile(graph, 'src/auth.ts', source);

// Query the graph
const loginFn = graph.resolve('login');
console.log(loginFn?.signature);
// → "async function login(user: string, pass: string): Token"

// Get AI-optimized context (respects token budget)
const context = buildContext(graph, [loginFn!.id], {
  maxTokens: 2000,
  includeSignatures: true,
  includeDoc: true,
  depth: 3,
});
console.log(context.context);
console.log(`Estimated tokens: ${context.estimatedTokens}`);

// Analyze change impact
const impact = analyzeImpact(graph, loginFn!.id);
console.log(`Changing login() impacts ${impact.stats.totalImpacted} symbols`);
```

## Core Concepts

### Nodes (Code Entities)

| Type | Description |
|------|-------------|
| `file` | A source file |
| `module` | A module/namespace |
| `class` | A class definition |
| `function` | A function or method |
| `variable` | A variable/constant |
| `type` | A type/interface definition |
| `export` | An export declaration |
| `doc` | Documentation (README, JSDoc) |
| `snippet` | A code snippet for RAG |

### Edges (Relationships)

| Type | Description |
|------|-------------|
| `contains` | File contains function, class contains method |
| `calls` | Function A calls function B |
| `imports` | File A imports from file B |
| `extends` | Class A extends class B |
| `implements` | Class implements interface |
| `references` | Function references variable |
| `exports` | File exports symbol |
| `depends_on` | Module A depends on module B |
| `documents` | Doc node documents code node |
| `tagged_with` | Entity tagged with a category |

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

### Serialization

```typescript
import { toJSONString, fromJSONString, saveToFile, loadFromFile } from 'kc-graph';

// JSON string (sync)
const json = toJSONString(graph);
const restored = fromJSONString(json);

// File persistence (async)
await saveToFile(graph, '.kc-graph.json');
const loaded = await loadFromFile('.kc-graph.json');

// Compressed (for large codebases)
import { saveCompressed, loadCompressed } from 'kc-graph';
await saveCompressed(graph, '.kc-graph.cache');
```

### MCP Integration

```typescript
import { createToolHandlers, toolDefinitions } from 'kc-graph';

// Get MCP tool schemas (for registering with your MCP server)
console.log(toolDefinitions);

// Create handlers bound to your graph
const handlers = createToolHandlers(graph);

// Handle a tool call
const result = handlers.search_code({ query: 'login', type: 'function' });
const context = handlers.get_context({ symbol: 'login', maxTokens: 2000 });
const impact = handlers.get_impact({ symbol: 'login' });
const structure = handlers.get_structure({ path: 'src/auth.ts' });
```

## Using with Claude Code

kc-graph can be used as an MCP server with Claude Code to give the AI deep understanding of your codebase:

1. Index your project once (save to `.kc-graph.json`)
2. Register the MCP tools with your Claude Code setup
3. The AI queries the graph instead of reading entire files

This dramatically reduces token usage while giving the AI better understanding of code relationships.

## Performance

kc-graph is built with V8 engine optimizations in mind:

- **Monomorphic object shapes** — all nodes share one hidden class for optimal inline caching
- **Map-based adjacency** — O(1) for all lookups, faster than plain objects for dynamic keys
- **Float32Array embeddings** — 4x less memory than `number[]`, SIMD-eligible
- **Generator-based traversals** — lazy evaluation, never materializes full result sets
- **Array-backed BFS queue** — avoids `shift()` O(n) cost with head pointer
- **Loop-unrolled cosine similarity** — 4 elements per iteration for better ILP

## License

MIT
