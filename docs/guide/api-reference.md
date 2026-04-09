# API Reference

## CodeGraph

The main graph class.

### Constructor

```typescript
const graph = new CodeGraph();
```

### Node Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `addNode(input)` | `CodeNode` | Add a node to the graph |
| `getNode(id)` | `CodeNode \| undefined` | Get a node by ID |
| `hasNode(id)` | `boolean` | Check if a node exists |
| `removeNode(id)` | `boolean` | Remove a node and its edges |
| `updateNode(id, updates)` | `CodeNode` | Update node properties |

### Edge Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `addEdge(input)` | `CodeEdge` | Add a directed edge |
| `getEdge(id)` | `CodeEdge \| undefined` | Get an edge by ID |
| `hasEdge(id)` | `boolean` | Check if an edge exists |
| `removeEdge(id)` | `boolean` | Remove an edge |

### Neighbor Queries

| Method | Returns | Description |
|--------|---------|-------------|
| `getOutEdges(nodeId, edgeTypes?)` | `CodeEdge[]` | Outbound edges |
| `getInEdges(nodeId, edgeTypes?)` | `CodeEdge[]` | Inbound edges |
| `getSuccessors(nodeId, edgeTypes?)` | `CodeNode[]` | Outbound neighbors |
| `getPredecessors(nodeId, edgeTypes?)` | `CodeNode[]` | Inbound neighbors |
| `getNeighbors(nodeId, edgeTypes?)` | `CodeNode[]` | All neighbors |

### Search

| Method | Returns | Description |
|--------|---------|-------------|
| `findNodes(filter)` | `CodeNode[]` | Filter nodes |
| `findByName(name)` | `CodeNode[]` | Find by name (case-insensitive) |
| `findByFile(path)` | `CodeNode[]` | Find by file path |
| `findByType(type)` | `CodeNode[]` | Find by node type |
| `resolve(identifier, file?)` | `CodeNode \| undefined` | Smart resolve |

### Bulk Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `removeFile(path)` | `number` | Remove all nodes for a file |
| `clear()` | `void` | Clear entire graph |

### Statistics

| Property/Method | Returns | Description |
|--------|---------|-------------|
| `nodeCount` | `number` | Total nodes |
| `edgeCount` | `number` | Total edges |
| `fileCount` | `number` | Indexed files |
| `getFiles()` | `string[]` | All file paths |
| `allNodes()` | `Iterator<CodeNode>` | Iterate all nodes |
| `allEdges()` | `Iterator<CodeEdge>` | Iterate all edges |

## Operations

### Traversal

```typescript
import { bfs, dfs, kHopNeighborhood } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `bfs(graph, startId, options?)` | Breadth-first generator |
| `dfs(graph, startId, options?)` | Depth-first generator |
| `kHopNeighborhood(graph, seedIds, k, edgeTypes?)` | All nodes within k hops |

### Query

```typescript
import { query } from 'kc-graph';
```

Returns a `GraphQuery` with chainable filters: `.ofType()`, `.inFile()`, `.withName()`, `.withContent()`, `.withEmbedding()`, `.withMetadata()`, `.withOutEdge()`, `.withInEdge()`, `.where()`.

Terminators: `.results()`, `.count()`, `.first()`.

### Impact

```typescript
import { analyzeImpact, formatImpactSummary } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `analyzeImpact(graph, nodeId, options?)` | Trace change impact |
| `formatImpactSummary(result)` | Human-readable summary |

### Subgraph

```typescript
import { extractSubgraph, getFileStructure } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `extractSubgraph(graph, seedIds, options?)` | Extract neighborhood as new graph |
| `getFileStructure(graph, filePath)` | Get containment tree |

## AI

### Context Builder

```typescript
import { buildContext, getContextForSymbol, getContextForFile } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `buildContext(graph, seedIds, options)` | Token-budget context extraction |
| `getContextForSymbol(graph, name, options?)` | Context by symbol name |
| `getContextForFile(graph, path, options?)` | Context for a file |

### Embeddings

```typescript
import { cosineSimilarity, findSimilar, setEmbedding, setEmbeddings } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `cosineSimilarity(a, b)` | Cosine similarity of two Float32Arrays |
| `findSimilar(graph, embedding, k, threshold?)` | Top-k similar nodes |
| `setEmbedding(graph, identifier, embedding, file?)` | Set embedding on a node |
| `setEmbeddings(graph, map)` | Batch set embeddings |

### Relevance

```typescript
import { scoreRelevance, rankByRelevance } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `scoreRelevance(seed, candidate, distance, edgeType, weights?)` | Score a single candidate |
| `rankByRelevance(graph, seedIds, maxDepth?, weights?)` | Rank all neighbors |

## Parser

```typescript
import { parseTypeScriptSource, indexSourceFile, indexDocFile } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `parseTypeScriptSource(filePath, source, options?)` | Parse TS/JS to nodes/edges |
| `indexSourceFile(graph, filePath, source, options?)` | Parse and add to graph |
| `indexDocFile(graph, filePath, content)` | Parse markdown and add to graph |

## Storage (Chunked Persistence)

```typescript
import { ChunkStore, resolveStore, createStore, initProject, syncProject } from 'kc-graph';
```

| Function / Class | Description |
|------------------|-------------|
| `initProject(options?)` | Index a project from scratch (returns `SyncResult`) |
| `syncProject(options?)` | Incremental sync — only re-index changed files |
| `removeProject(projectRoot, options?)` | Remove indexed data and registry entry |
| `resolveStore(projectRoot, options?)` | Find existing storage (local first, then global) |
| `createStore(projectRoot, options?)` | Create new storage |
| `ChunkStore` | Low-level chunked storage (init, saveGraph, loadGraph, syncFiles, cleanup) |

### IndexOptions

```typescript
await initProject({
  root: './my-project',       // Project directory
  global: false,              // Use global ~/.kc-graph/ storage
  scope: 'develop',           // Scope name (optional)
  force: false,               // Skip branch safety check (optional)
  config: { chunkSize: 262144 }, // Storage config overrides
  onProgress: (file, i, total) => { },
  onError: (file, error) => { },
});
```

## Serialization (Legacy Single-File)

```typescript
import { exportToJSON, importFromJSON, toJSONString, fromJSONString } from 'kc-graph';
import { saveToFile, loadFromFile, saveCompressed, loadCompressed } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `exportToJSON(graph)` | Export to snapshot object |
| `importFromJSON(snapshot)` | Import from snapshot |
| `toJSONString(graph, pretty?)` | Serialize to JSON string |
| `fromJSONString(json)` | Deserialize from JSON string |
| `saveToFile(graph, path)` | Save to JSON file |
| `loadFromFile(path)` | Load from JSON file |
| `saveCompressed(graph, path)` | Save gzip-compressed |
| `loadCompressed(path)` | Load gzip-compressed |

## MCP

```typescript
import { toolDefinitions, createToolHandlers, singleProject, startMcpServer } from 'kc-graph';
```

| Export | Description |
|--------|-------------|
| `toolDefinitions` | MCP tool schemas (8 tools: list_projects, search_code, get_context, get_impact, get_structure, find_similar, review_changes, find_unused) |
| `createToolHandlers(projects, scope?)` | Create handler functions bound to a `ProjectMap` |
| `singleProject(name, graph, path)` | Create a `ProjectMap` with one project |
| `startMcpServer(projects, options?)` | Start stdio MCP server. Options: `{ scope?, storePaths? }` or scope string |

All tools accept an optional `project` parameter to scope queries to a specific project when running in multi-project mode.

## Scope

```typescript
import {
  resolveScope, validateScopeName, getActiveScope, setActiveScope,
  resetActiveScope, listScopes, scopeExists, deleteScope,
  ensureScopeDir, scopePath, detectGitBranch, DEFAULT_SCOPE,
} from 'kc-graph';
```

| Function | Returns | Description |
|----------|---------|-------------|
| `resolveScope(explicit?)` | `string` | Resolve scope: flag > `KC_GRAPH_SCOPE` env > config > `"default"` |
| `validateScopeName(name)` | `void` | Throw if name is invalid (`^[a-z][a-z0-9-]{0,49}$`) |
| `getActiveScope()` | `string` | Read active scope from `config.json` |
| `setActiveScope(scope)` | `void` | Write active scope to `config.json` |
| `resetActiveScope()` | `void` | Reset active scope to `"default"` |
| `listScopes(global, projectRoot?)` | `ScopeInfo[]` | List all scopes with project counts and last sync |
| `scopeExists(scope, global, projectRoot?)` | `boolean` | Check if a scope directory exists |
| `deleteScope(scope, global, projectRoot?)` | `void` | Delete a scope (cannot delete `"default"`) |
| `ensureScopeDir(scope, global, projectRoot?)` | `string` | Create scope directory with `scope.json` (idempotent) |
| `scopePath(scope, global, projectRoot?)` | `string` | Get base path for a scope's storage |
| `detectGitBranch(projectRoot)` | `string \| null` | Detect current git branch (null if not a git repo) |
| `DEFAULT_SCOPE` | `"default"` | The default scope name constant |

### ScopeInfo

```typescript
interface ScopeInfo {
  name: string;        // Scope name
  projectCount: number; // Number of projects in this scope
  lastSync: number;     // Most recent sync timestamp (ms)
  createdAt: number;    // When scope was created (ms)
  active: boolean;      // Whether this is the active scope
}
```

See [Scoped Environments](/guide/scopes) for the full guide.

## Viewer

```typescript
import { startViewer, exportViewerHTML } from 'kc-graph';
```

| Function | Description |
|----------|-------------|
| `startViewer(graph, options?)` | Start local HTTP server with interactive graph visualization |
| `exportViewerHTML(graph)` | Export self-contained HTML string for static hosting |

### ViewerOptions

```typescript
startViewer(graph, {
  port: 4242,        // HTTP port (default: 4242)
  host: 'localhost', // Bind address
  open: true,        // Auto-open browser (default: true)
});
```
