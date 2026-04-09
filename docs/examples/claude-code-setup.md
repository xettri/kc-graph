# Using kc-graph with Claude Code

Complete end-to-end guide: install, index, configure, and use all MCP tools from Claude Code.

## Step 1: Install

```bash
npm install -g kc-graph
```

Verify it's installed:

```bash
kc-graph --version
```

## Step 2: Index Your Project

```bash
cd ~/work/my-api
kc-graph init
```

You'll see output like:

```
Indexing /home/user/work/my-api ...
  Indexed 48/48 files

Done in 2.3s
  48 files indexed
  312 nodes, 187 edges
  8 chunks written
  Saved to .kc-graph/
```

This creates a `.kc-graph/` directory in your project with the indexed graph.

## Step 3: Configure Claude Code

Run the setup command to get the config:

```bash
kc-graph setup
```

Then add to your Claude Code settings (`~/.claude/settings.json`):

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

Or add a `.mcp.json` to your project root (preferred for per-project config):

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

Restart Claude Code to load the MCP server.

## Step 4: Verify It Works

Open Claude Code and try:

> "Use the list_projects tool to show my indexed projects"

Claude will call the MCP tool and respond with:

```json
[{
  "name": "my-api",
  "path": "/home/user/work/my-api",
  "nodes": 312,
  "edges": 187,
  "files": 48
}]
```

## Step 5: Try Each Tool

### Search for code

> "Search for all functions named 'handle' in my project"

Claude calls `search_code` with `{ query: "handle", type: "function" }` and returns matching functions with file paths and signatures.

### Get context for a symbol

> "Get me the context for the login function"

Claude calls `get_context` with `{ symbol: "login", maxTokens: 4000 }` and returns token-optimized code context including the function itself plus related callers, callees, and imports — all within the token budget.

### Analyze impact of a change

> "What would break if I change the validate function?"

Claude calls `get_impact` with `{ symbol: "validate", maxDepth: 5 }` and returns the full impact tree: which functions call validate, what calls those functions, transitively across files.

### See file structure

> "Show me the structure of src/auth/handler.ts"

Claude calls `get_structure` with `{ path: "src/auth/handler.ts" }` and returns a JSON tree of all classes, functions, variables, and exports in that file.

### Review changed files

> "Review the changes in src/auth.ts and src/utils.ts"

Claude calls `review_changes` with `{ files: ["src/auth.ts", "src/utils.ts"] }` and returns:
- What symbols exist in those files
- Impact analysis: what downstream code is affected
- Token-budgeted context covering the blast radius

### Find dead code

> "Find any unused functions in my project"

Claude calls `find_unused` with `{ type: "function" }` and returns functions with no callers or importers, sorted by confidence.

### Find similar code

> "Find code similar to the validate function"

Claude calls `find_similar` with `{ symbol: "validate" }` — requires embeddings to be set up on nodes.

## Step 6: Keep the Graph Updated

### Manual sync

```bash
kc-graph sync
```

Only re-indexes files that changed since the last sync. Fast for incremental updates.

### Watch mode (recommended)

```bash
kc-graph watch
```

Automatically detects file changes and syncs the graph in the background. Output:

```
Watching /home/user/work/my-api for changes...
Press Ctrl+C to stop.

[sync] +1 added, ~2 updated (0.3s)
[sync] ~1 updated (0.1s)
```

### Check graph health

```bash
kc-graph status
```

Shows staleness, node/edge counts, most connected symbols, and storage size.

## Multi-Project Setup

Index multiple projects into the global store:

```bash
kc-graph init --global ~/work/api-server
kc-graph init --global ~/work/frontend
kc-graph init --global ~/work/shared-lib
```

Configure Claude Code for multi-project mode:

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

Now you can search across all projects:

> "Search for the UserService class across all my projects"

Claude calls `search_code` with `{ query: "UserService", type: "class" }` and searches all three indexed projects.

To scope a query to one project:

> "Get the impact of changing validate in the api-server project"

Claude calls `get_impact` with `{ symbol: "validate", project: "api-server" }`.

## All Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List indexed projects with stats |
| `search_code` | Find symbols by name, type, file |
| `get_context` | Token-optimized context for a symbol or file |
| `get_impact` | Change impact analysis |
| `get_structure` | File structure overview |
| `find_similar` | Semantic similarity search |
| `review_changes` | Analyze changed files with impact + context |
| `find_unused` | Find dead code (no callers/importers) |

## Using Scopes

If you work across multiple environments (develop, staging, prod), scopes keep your graphs isolated:

```bash
# Set active scope
kc-graph scope use develop

# Index projects into that scope
kc-graph init --global ~/work/api-server
kc-graph init --global ~/work/frontend

# Configure Claude Code for this scope
kc-graph setup --scope develop
```

Then add to `.mcp.json` or `settings.json`:

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

See the full [Scoped Environments](/guide/scopes) guide for details.

## Tips

- **Use `watch` mode** during development so the graph stays fresh
- **Ask Claude about impact** before making changes to shared functions
- **Use `get_context`** when Claude needs to understand surrounding code
- **Use `review_changes`** for code review — it focuses on the blast radius
- **Multi-project mode** is great for microservice architectures
- **Use scopes** to maintain separate graphs per branch/environment
