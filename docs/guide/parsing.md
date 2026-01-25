# Parsing & Indexing

## TypeScript/JavaScript Parser

kc-graph includes a built-in parser that uses the TypeScript Compiler API to extract code entities from source files.

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

The parser extracts:

- **Functions** — name, signature, body, JSDoc, line numbers
- **Classes** — name, heritage (extends/implements), methods
- **Variables** — name, const/let distinction, initializer
- **Types** — interfaces and type aliases
- **Imports** — module specifiers
- **Exports** — exported symbols

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
2. Splits into sections by headings
3. Links doc sections to code nodes when backtick-wrapped symbol names are found (e.g., `` `login` ``)

## Index an Entire Project

```typescript
import { CodeGraph, indexSourceFile, indexDocFile } from 'kc-graph';
import { readFileSync } from 'fs';
import { globSync } from 'fs';

const graph = new CodeGraph();

// Index all TypeScript files
const tsFiles = globSync('src/**/*.ts');
for (const file of tsFiles) {
  indexSourceFile(graph, file, readFileSync(file, 'utf-8'));
}

// Index docs
const mdFiles = globSync('docs/**/*.md');
for (const file of mdFiles) {
  indexDocFile(graph, file, readFileSync(file, 'utf-8'));
}

console.log(`Graph: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`);
```
