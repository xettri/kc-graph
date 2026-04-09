## What is this?

Open-source TypeScript library and CLI for building code intelligence graphs. Maps codebases at module/function/variable level for token-efficient AI context retrieval. Published as `kc-graph` on npm.

## Architecture

```
src/
  core/         Graph data structure (CodeGraph, nodes, edges, types)
  parser/       TypeScript AST parser + markdown doc parser
  operations/   Traversal (BFS/DFS), query builder, impact analysis, subgraph
  ai/           Context builder (token-budget), embeddings (cosine), relevance scoring
  storage/      ChunkStore (chunked persistence), resolver (local/global), indexer
  mcp/          MCP stdio server (JSON-RPC 2.0) + tool handlers
  cli/          CLI entry point, file discovery, viewer (Cytoscape.js)
  serialization/ JSON export/import, snapshot persistence
  index.ts      Public API exports
```

## Key Design Decisions

- **Dual ESM/CJS build**: `dist/esm/` and `dist/cjs/` with `dist/cjs/package.json` containing `{"type":"commonjs"}`
- **CLI entry**: `dist/cjs/cli/cli.js` (CJS for global install compatibility)
- **TypeScript is a direct dependency** (not peer) — essential for parsing, must work when installed globally
- **TypeScript resolution**: tries project's own TS first (from cwd), falls back to bundled version
- **Cytoscape.js bundled inline** from node_modules for viewer (no CDN)
- **`</script>` escaping**: viewer uses `<\/script>` in inline JSON to avoid breaking HTML
- **Package manager**: pnpm (migrated from npm), with Husky + lint-staged pre-commit hooks
- **Storage**: local `.kc-graph/` per project or global `~/.kc-graph/` with registry

## CLI Commands

```
kc-graph init [path] [-g] [-s <scope>]    Index a project
kc-graph sync [path] [-g] [-s <scope>]    Incremental update (bulk if --global without path)
kc-graph remove [path] [-g] [-s <scope>]  Remove indexed data (requires --force)
kc-graph watch [-s <scope>]               Watch for file changes and auto-sync
kc-graph status [-s <scope>]              Show graph health and staleness
kc-graph view [-g] [-s <scope>] [--port]   Browser graph visualization (multi-project with --global)
kc-graph mcp [-g] [-s <scope>]            MCP server (auto-reloads on sync)
kc-graph mcp --global --no-reload         MCP server (static, no reload)
kc-graph setup [-s <scope>]               Print MCP config for Claude Code / Cursor
kc-graph scope                            Show active scope
kc-graph scope use <name>                 Set active scope
kc-graph scope reset                      Reset to default scope
kc-graph scope list [--global]            List all scopes
kc-graph scope delete <name> [--force]    Delete a scope
```

## MCP Tools (8 total)

All tools accept optional `project` param in multi-project mode.

| Tool            | Purpose                                      |
| --------------- | -------------------------------------------- |
| `list_projects` | Show indexed projects with stats             |
| `search_code`   | Find symbols by name/type/file               |
| `get_context`   | Token-optimized context for symbol/file      |
| `get_impact`    | Change impact analysis                       |
| `get_structure` | File structure (classes, functions, exports) |
| `find_similar`  | Semantic similarity (requires embeddings)    |
| `review_changes`| Analyze changed files with impact + context  |
| `find_unused`   | Find dead code (no callers/importers)        |

## Multi-Project MCP

The core differentiator. One MCP server serves multiple projects:

```bash
kc-graph init --global ~/work/project-a
kc-graph init --global ~/work/project-b
kc-graph mcp --global
```

Architecture: `ProjectMap = Map<string, { graph, path }>`. Single project uses `singleProject()` helper. Global mode uses `loadAllGlobalProjects()` from resolver.

## Scripts

```
pnpm run build        # clean + build ESM + CJS
pnpm run test         # vitest (192 tests)
pnpm run typecheck    # tsc --noEmit
pnpm run local:link   # build + npm link (for testing CLI globally)
pnpm run local:unlink # remove global link
pnpm run prepack      # build + typecheck (runs before npm pack/publish)
```

## Tests

192 tests across 14 suites:

- core/graph, operations (traversal, query, impact, subgraph)
- parser (typescript, doc), serialization (json)
- storage (chunk-store, resolver), ai (context-builder, embeddings)
- mcp (tools — single + multi-project, server protocol)

## Important Files

- `src/mcp/tools.ts` — ProjectMap type, singleProject(), all tool handlers
- `src/mcp/server.ts` — MCP stdio server (Content-Length framing)
- `src/cli/cli.ts` — CLI with all commands including setup
- `src/storage/resolver.ts` — local/global storage resolution, loadAllGlobalProjects()
- `src/parser/load-typescript.ts` — TS resolution (cwd first, then bundled)
- `src/cli/viewer.ts` — Cytoscape.js viewer (inline bundled, NX-style UI)
- `src/storage/indexer.ts` — initProject/syncProject with mtime change detection

## Docs

VitePress site under `docs/`:

- `guide/` — getting-started, core-concepts, parsing, querying, ai-context, claude-code, api-reference
- `examples/` — basic-usage, code-review, mcp-integration
- `public/graph.html` — pre-built static graph of kc-graph itself
