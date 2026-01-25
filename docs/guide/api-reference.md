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

## Serialization

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
import { toolDefinitions, createToolHandlers } from 'kc-graph';
```

| Export | Description |
|--------|-------------|
| `toolDefinitions` | MCP tool schemas (search_code, get_context, get_impact, get_structure, find_similar) |
| `createToolHandlers(graph)` | Create handler functions bound to a graph |
