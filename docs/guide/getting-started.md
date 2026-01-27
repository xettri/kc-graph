# Getting Started

## Installation

```bash
npm install kc-graph
```

For TypeScript/JavaScript parsing, install TypeScript as a peer dependency:

```bash
npm install typescript
```

## Quick Start

### 1. Create a Graph

```typescript
import { CodeGraph } from 'kc-graph';

const graph = new CodeGraph();
```

### 2. Add Nodes Manually

```typescript
const authFile = graph.addNode({
  type: 'file',
  name: 'auth.ts',
  qualifiedName: 'src/auth.ts',
  location: { file: 'src/auth.ts', startLine: 1, endLine: 50, startColumn: 0, endColumn: 0 },
});

const loginFn = graph.addNode({
  type: 'function',
  name: 'login',
  qualifiedName: 'src/auth.ts#login',
  content: 'async function login(user: string, pass: string) { ... }',
  signature: 'async function login(user: string, pass: string): Promise<Token>',
  location: { file: 'src/auth.ts', startLine: 5, endLine: 15, startColumn: 0, endColumn: 0 },
});

graph.addEdge({ source: authFile.id, target: loginFn.id, type: 'contains' });
```

### 3. Or Parse Source Files Automatically

```typescript
import { indexSourceFile } from 'kc-graph';
import { readFileSync } from 'fs';

const source = readFileSync('src/auth.ts', 'utf-8');
indexSourceFile(graph, 'src/auth.ts', source);
// Extracts functions, arrow functions, classes, variables, types,
// imports, call edges, and relationships automatically
```

### 4. Query the Graph

```typescript
// Find by name
const fn = graph.resolve('login');

// Find all functions in a file
const fns = graph.findByFile('src/auth.ts');

// Chainable queries
import { query } from 'kc-graph';
const handlers = query(graph)
  .ofType('function')
  .withName(/^handle/)
  .results();
```

### 5. Get AI-Optimized Context

```typescript
import { buildContext } from 'kc-graph';

const ctx = buildContext(graph, ['src/auth.ts#login'], {
  maxTokens: 2000,
  includeSignatures: true,
  depth: 3,
});

// Send ctx.context to your AI — it contains only the relevant code
console.log(`${ctx.estimatedTokens} tokens, ${ctx.files.length} files`);
```

### 6. Save & Load

```typescript
import { initProject, syncProject, resolveStore } from 'kc-graph';

// Option A: Use the high-level API (chunked storage)
await initProject({ root: './my-project' });
await syncProject({ root: './my-project' }); // incremental updates

// Option B: Load an existing graph
const store = resolveStore('./my-project');
const loaded = store.loadGraph();
```

### 7. Start MCP Server (for AI agents)

```bash
kc-graph init
kc-graph mcp
```

## Next Steps

- [Core Concepts](/guide/core-concepts) — understand nodes, edges, and the graph model
- [Parsing & Indexing](/guide/parsing) — call extraction, arrow functions, import resolution
- [AI Context Builder](/guide/ai-context) — token-budget-aware retrieval
- [Claude Code Integration](/guide/claude-code) — MCP server setup
