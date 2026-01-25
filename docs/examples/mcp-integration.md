# MCP Integration

This example shows how to expose kc-graph as an MCP server for AI agents.

## Setup

```typescript
import {
  CodeGraph,
  indexSourceFile,
  loadFromFile,
  saveToFile,
  createToolHandlers,
  toolDefinitions,
} from 'kc-graph';

// Load or build the graph
let graph: CodeGraph;
try {
  graph = await loadFromFile('.kc-graph.json');
} catch {
  graph = new CodeGraph();
  // Index your project...
  await saveToFile(graph, '.kc-graph.json');
}

// Create tool handlers
const handlers = createToolHandlers(graph);
```

## Tool Definitions

kc-graph exports MCP-compatible tool schemas:

```typescript
console.log(Object.keys(toolDefinitions));
// ['search_code', 'get_context', 'get_impact', 'get_structure', 'find_similar']
```

## Handling Tool Calls

```typescript
// Search for code
const searchResult = handlers.search_code({
  query: 'login',
  type: 'function',
  file: 'src/auth/*',
});
console.log(searchResult.content[0].text);
// [{ name: "login", type: "function", file: "src/auth/handler.ts", line: 42, signature: "..." }]

// Get context
const contextResult = handlers.get_context({
  symbol: 'login',
  file: 'src/auth/handler.ts',
  maxTokens: 2000,
});
console.log(contextResult.content[0].text);
// Formatted context with [TARGET] node + related signatures

// Impact analysis
const impactResult = handlers.get_impact({
  symbol: 'validate',
  maxDepth: 5,
});
console.log(impactResult.content[0].text);
// Impact summary with affected files and symbols

// File structure
const structureResult = handlers.get_structure({
  path: 'src/auth/handler.ts',
});
console.log(structureResult.content[0].text);
// JSON structure of all symbols in the file

// Find similar (requires embeddings)
const similarResult = handlers.find_similar({
  symbol: 'login',
  limit: 5,
});
```

## Error Handling

All handlers return `{ content, isError? }`:

```typescript
const result = handlers.get_context({ symbol: 'nonexistent' });
if (result.isError) {
  console.error(result.content[0].text); // "Not found: nonexistent"
}
```
