# Parsing & Indexing

## TypeScript/JavaScript Parser

kc-graph includes a built-in parser that uses the TypeScript Compiler API to extract code entities and their relationships from source files.

### Requirements

TypeScript must be installed as a peer dependency:

```bash
npm install typescript
```

### Index a Single File

```typescript
import { CodeGraph, indexSourceFile } from 'kc-graph';
import { readFileSync } from 'fs';

const graph = new CodeGraph();
const source = readFileSync('src/auth.ts', 'utf-8');
const nodeCount = indexSourceFile(graph, 'src/auth.ts', source);
console.log(`Indexed ${nodeCount} nodes`);
```

### What Gets Extracted

The parser extracts entities and their relationships:

| Feature | Node Type | Edge Types |
|---------|-----------|------------|
| Function declarations | `function` | `contains`, `exports` |
| Arrow functions (`const fn = () => {}`) | `function` | `contains`, `exports` |
| Function expressions | `function` | `contains`, `exports` |
| Class declarations | `class` | `contains`, `exports` |
| Class methods | `function` | `contains` |
| Constructors | `function` | `contains` |
| Arrow class properties (`handler = () => {}`) | `function` | `contains` |
| Variables and constants | `variable` | `contains`, `exports` |
| Interfaces and type aliases | `type` | `contains`, `exports` |
| Heritage clauses | — | `extends`, `implements` |

### Call Extraction

The parser walks function and method bodies to extract **call edges**:

```typescript
const source = `
export function main() {
  const result = helper();    // → calls edge: main → helper
  process(result);            // → calls edge: main → process
}

function helper() { return 'data'; }

const runner = () => {
  main();                     // → calls edge: runner → main
};
`;

indexSourceFile(graph, 'src/app.ts', source);

// The graph now has calls edges between functions
const edges = [...graph.allEdges()].filter(e => e.type === 'calls');
// main → helper, main → process, runner → main
```

Detected call patterns:
- Direct calls: `foo()`
- Method calls: `this.method()`, `obj.method()`
- Constructor calls: `new Foo()`
- Calls inside arrow functions and class methods

### Import Resolution

Relative imports are resolved to actual file paths:

```typescript
// In src/lib/app.ts:
import { helper } from './utils';    // → resolves to src/lib/utils.ts
import { config } from '../config';  // → resolves to src/config.ts
import express from 'express';       // → stays as 'express' (bare specifier)
```

Named imports create edges to specific symbols:

```typescript
import { readFile, writeFile } from 'node:fs/promises';
// Creates edges:
//   src/app.ts → node:fs/promises          (file-level import)
//   src/app.ts → node:fs/promises#readFile  (named import)
//   src/app.ts → node:fs/promises#writeFile (named import)
```

Re-exports are also detected:

```typescript
export { helper } from './utils';     // import + export edges
export * from './types';              // star re-export
export { foo, bar };                  // local named exports
```

### Parser Options

```typescript
indexSourceFile(graph, 'src/auth.ts', source, {
  includeBody: true,         // Include function bodies (default: true)
  includeJSDoc: true,        // Extract JSDoc comments (default: true)
  maxContentLength: 5000,    // Truncate large functions (default: 5000 chars)
});
```

### Incremental Re-indexing

When a file changes, re-index it. kc-graph automatically removes old nodes for that file before adding new ones:

```typescript
// File changed — just re-index
const updatedSource = readFileSync('src/auth.ts', 'utf-8');
indexSourceFile(graph, 'src/auth.ts', updatedSource);
// Old nodes removed, new nodes added
```

## Markdown Documentation Parser

```typescript
import { indexDocFile } from 'kc-graph';
import { readFileSync } from 'fs';

const readme = readFileSync('README.md', 'utf-8');
indexDocFile(graph, 'README.md', readme);
```

The doc parser:
1. Creates a doc node for the file
2. Splits into sections by headings (tracks heading level)
3. Links doc sections to code nodes when backtick-wrapped symbol names are found (e.g., `` `login` ``)

## Index an Entire Project

### Using the CLI (recommended)

```bash
kc-graph init ./my-project
```

### Using the Library API

```typescript
import { initProject, syncProject } from 'kc-graph';

// Full index
const result = await initProject({
  root: './my-project',
  onProgress: (file, i, total) => console.log(`${i}/${total}: ${file}`),
});
console.log(`${result.totalNodes} nodes, ${result.totalEdges} edges in ${result.totalChunks} chunks`);

// Incremental sync (only changed files)
const sync = await syncProject({ root: './my-project' });
console.log(`+${sync.added} added, ~${sync.updated} updated, -${sync.removed} removed`);
```
