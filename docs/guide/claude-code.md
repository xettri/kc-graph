# Claude Code Integration

kc-graph includes a built-in MCP server that gives AI agents deep codebase understanding out of the box.

## Quick Setup

```bash
# 1. Index your project
kc-graph init

# 2. Start MCP server
kc-graph mcp
```

That's it. The server loads the graph from `.kc-graph/` and serves 5 tools over stdio.

## Configure Claude Code

Add to your Claude Code `settings.json`:

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

For a specific project path:

```json
{
  "mcpServers": {
    "kc-graph": {
      "command": "kc-graph",
      "args": ["mcp", "/path/to/project"]
    }
  }
}
```

## Available MCP Tools

| Tool | Description | Input |
|------|-------------|-------|
| `search_code` | Find functions, classes, variables | `{ query, type?, file? }` |
| `get_context` | Token-optimized context for a symbol | `{ symbol, file?, maxTokens? }` |
| `get_impact` | Change impact analysis | `{ symbol, file?, maxDepth? }` |
| `get_structure` | File structure overview | `{ path }` |
| `find_similar` | Find semantically similar code | `{ symbol, file?, limit? }` |

## Why This Helps

Instead of the AI reading entire files to understand your code, kc-graph provides a pre-built knowledge graph. This:

- Reduces token usage by 60-90%
- Gives the AI understanding of call chains and dependencies
- Enables impact analysis before making changes
- Provides semantic search across the codebase

## Example AI Workflows

### Code Review

1. AI receives a diff
2. AI calls `get_impact` for each changed function
3. AI sees exactly what else breaks — across files, through call chains
4. AI provides targeted review comments

### Code Generation

1. User asks to add a feature
2. AI calls `search_code` to find related existing code
3. AI calls `get_context` to understand the surrounding code
4. AI calls `get_structure` to see where to add the new code
5. AI generates code that fits existing patterns

### Bug Investigation

1. User reports a bug in function X
2. AI calls `get_context` for function X with high token budget
3. AI follows `calls` and `imports` edges via impact analysis
4. AI traces the bug to its root cause through the graph

## Keeping the Graph Updated

```bash
# Sync on file changes (only re-indexes changed files)
kc-graph sync
```

Or programmatically:

```typescript
import { syncProject } from 'kc-graph';

const result = await syncProject({ root: '/path/to/project' });
console.log(`+${result.added} added, ~${result.updated} updated, -${result.removed} removed`);
```

## Programmatic Server

You can also start the MCP server from code:

```typescript
import { resolveStore, startMcpServer } from 'kc-graph';

const store = resolveStore('/path/to/project');
const graph = store.loadGraph();
startMcpServer(graph);
```
