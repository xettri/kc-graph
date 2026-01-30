# MCP Integration

## Quick Start (CLI)

The easiest way to use kc-graph with AI agents:

```bash
# Index your project
kc-graph init

# Start MCP server over stdio
kc-graph mcp
```

Configure your AI client to use it:

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

Run `kc-graph setup` to get the config snippet for your tool.

## Multi-Project Mode

Index multiple projects into the global store and serve them from a single MCP server:

```bash
kc-graph init --global ~/work/api-server
kc-graph init --global ~/work/frontend
kc-graph init --global ~/work/shared-lib

# One server, all projects
kc-graph mcp --global
```

```json
{
  "mcpServers": {
    "kc-graph": {
      "command": "kc-graph",
      "args": ["mcp", "--global"]
    }
  }
}
```

## Programmatic Setup

```typescript
import { resolveStore, startMcpServer, singleProject } from 'kc-graph';

const store = resolveStore('/path/to/project');
const graph = store.loadGraph();

startMcpServer(singleProject('my-project', graph, '/path/to/project'));
```

## Using Tool Handlers Directly

If you're building your own MCP server or integration:

```typescript
import { createToolHandlers, singleProject, toolDefinitions } from 'kc-graph';

const projects = singleProject('my-project', graph, '/path/to/project');
const handlers = createToolHandlers(projects);
```

### Tool Definitions

```typescript
console.log(Object.keys(toolDefinitions));
// ['list_projects', 'search_code', 'get_context', 'get_impact', 'get_structure', 'find_similar']
```

### Handling Tool Calls

```typescript
// List indexed projects
const projectList = handlers.list_projects({});
console.log(projectList.content[0].text);
// [{ name: "my-project", path: "/path/to/project", nodes: 142, edges: 89, files: 12 }]

// Search for code (optional project filter in multi-project mode)
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

### Error Handling

All handlers return `{ content, isError? }`:

```typescript
const result = handlers.get_context({ symbol: 'nonexistent' });
if (result.isError) {
  console.error(result.content[0].text); // "Not found: nonexistent"
}
```
