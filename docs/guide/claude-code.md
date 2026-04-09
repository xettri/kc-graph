# Claude Code Integration

kc-graph includes a built-in MCP server that gives AI agents deep codebase understanding out of the box.

## Quick Setup

```bash
# 1. Index your project
kc-graph init

# 2. Start MCP server
kc-graph mcp
```

The server loads the graph from `.kc-graph/` and serves 8 tools over stdio.

## Configure Claude Code

### Quick add (recommended)

```bash
# Single project
claude mcp add kc-graph -- kc-graph mcp

# Multi-project (global)
claude mcp add kc-graph -- kc-graph mcp --global

# With scope
claude mcp add kc-graph -- kc-graph mcp --global --scope develop
```

### Manual config

Add to `~/.claude/settings.json`:

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

### Using `.mcp.json` (per-project)

Add a `.mcp.json` file to your project root for project-scoped MCP configuration:

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

Multi-project with global storage:

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

With a specific scope:

```json
{
  "mcpServers": {
    "kc-graph": {
      "command": "kc-graph",
      "args": ["mcp", "--global", "--scope", "develop"]
    }
  }
}
```

Run `kc-graph setup` (or `kc-graph setup --scope develop`) to generate the config snippet.

## Multi-Project Mode

Index multiple projects globally and serve them from one MCP server:

```bash
kc-graph init --global ~/work/api-server
kc-graph init --global ~/work/frontend
kc-graph init --global ~/work/shared-lib
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

All tools search across all projects by default. Use the `project` parameter to scope queries to a single project.

## Available MCP Tools

| Tool | Description | Input |
|------|-------------|-------|
| `list_projects` | List all indexed projects with stats | `{}` |
| `search_code` | Find functions, classes, variables | `{ query, type?, file?, project? }` |
| `get_context` | Token-optimized context for a symbol | `{ symbol?, file?, maxTokens?, project? }` |
| `get_impact` | Change impact analysis | `{ symbol, file?, maxDepth?, project? }` |
| `get_structure` | File structure overview | `{ path, project? }` |
| `find_similar` | Find semantically similar code | `{ symbol, file?, limit?, project? }` |
| `review_changes` | Analyze changed files with impact + context | `{ files, maxTokens?, project? }` |
| `find_unused` | Find dead code with no callers | `{ path?, type?, project? }` |

All tools accept an optional `project` parameter in multi-project mode to scope queries.

## Example Prompts

Here are prompts you can use directly in Claude Code once kc-graph is configured:

### Exploring the codebase

```
Use kc-graph to list all indexed projects and their stats.

Search for all functions related to "auth" across my projects.

Show me the structure of src/controllers/userController.ts using kc-graph.
```

### Understanding code

```
Use kc-graph to get the full context for the validateToken function
with a 6000 token budget. I need to understand how it works and what
calls it.

Get me the context for the payment module. Include all related functions
and their callers.
```

### Impact analysis before changes

```
I'm about to refactor the DatabasePool class. Use kc-graph to analyze
the impact — show me everything that would be affected by changes to it.

Before I change the response format of getUserProfile, use get_impact
to show me all callers across all projects.
```

### Code review

```
I changed src/auth/handler.ts and src/middleware/cors.ts. Use
review_changes to analyze what other code is affected by these changes
and build a review context.
```

### Finding dead code

```
Use kc-graph to find all unused functions in the src/utils/ directory.

Find all dead code in my project — functions and variables with no
callers or importers.
```

### Cross-project queries

```
Search for the UserProfile type across all my projects. I want to see
where it's defined and where it's used.

Get the impact of changing the ApiResponse type in the api-server project.
Show me what breaks in both api-server and frontend.
```

## Why This Helps

Instead of the AI reading entire files to understand your code, kc-graph provides a pre-built knowledge graph. This:

- Reduces token usage by 60-90%
- Gives the AI understanding of call chains and dependencies
- Enables impact analysis before making changes
- Provides semantic search across the codebase

## Example AI Workflows

### Code Review

1. AI receives a diff
2. AI calls `review_changes` with the changed file paths
3. AI sees what symbols exist, what downstream code is affected
4. AI provides targeted review comments based on the blast radius

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

### Refactoring

1. User wants to rename or move a function
2. AI calls `get_impact` to see all callers and dependents
3. AI calls `get_context` for each affected area
4. AI updates all references across the codebase

## Keeping the Graph Updated

```bash
# Manual sync (only re-indexes changed files)
kc-graph sync

# Watch mode — auto-syncs when files change (recommended)
kc-graph watch

# Check if graph is stale
kc-graph status
```

Watch mode uses file system events with debouncing to keep the graph fresh as you edit code. Start it in a separate terminal and forget about it.

Or programmatically:

```typescript
import { syncProject } from 'kc-graph';

const result = await syncProject({ root: '/path/to/project' });
console.log(`+${result.added} added, ~${result.updated} updated, -${result.removed} removed`);
```

## Programmatic Server

You can also start the MCP server from code:

```typescript
import { resolveStore, startMcpServer, singleProject } from 'kc-graph';

const store = resolveStore('/path/to/project');
const graph = store.loadGraph();
startMcpServer(singleProject('my-project', graph, '/path/to/project'));
```

With scope:

```typescript
import { loadAllGlobalProjects, startMcpServer } from 'kc-graph';

const projects = loadAllGlobalProjects('develop');
startMcpServer(projects, 'develop');
```

## Scoped Environments

For working across `develop`, `staging`, and `prod` branches, see the [Scoped Environments](/guide/scopes) guide. Scopes give you isolated graphs per environment with strict MCP isolation, bulk sync, and branch safety.
