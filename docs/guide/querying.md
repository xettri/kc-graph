# Querying & Traversal

## Finding Nodes

### By Name

```typescript
const nodes = graph.findByName('login');  // case-insensitive
```

### By File

```typescript
const nodes = graph.findByFile('src/auth.ts');
```

### By Type

```typescript
const functions = graph.findByType('function');
const classes = graph.findByType('class');
```

### Smart Resolve

`resolve()` tries multiple strategies — direct ID, qualified name, then symbol name:

```typescript
graph.resolve('src/auth.ts#login');  // by qualified name
graph.resolve('login');               // by symbol name
graph.resolve('login', 'src/auth.ts'); // narrowed by file
```

## Chainable Query Builder

```typescript
import { query } from 'kc-graph';

// Find all async handler functions in the auth module
const results = query(graph)
  .ofType('function')
  .inFile(/src\/auth/)
  .withName(/^handle/)
  .withMetadata('isAsync', true)
  .results();

// Count without allocating
const count = query(graph).ofType('function').count();

// First match only
const first = query(graph).ofType('class').withName('UserService').first();
```

### Available Filters

| Method | Description |
|--------|-------------|
| `.ofType(...types)` | Filter by node type |
| `.inFile(path \| regex)` | Filter by file path |
| `.withName(name \| regex)` | Filter by node name |
| `.withContent(regex)` | Filter by content |
| `.withEmbedding()` | Only nodes with embeddings |
| `.withMetadata(key, value?)` | Filter by metadata |
| `.withOutEdge(...types)` | Nodes with outbound edges |
| `.withInEdge(...types)` | Nodes with inbound edges |
| `.where(predicate)` | Custom filter function |

## Graph Traversal

### BFS (Breadth-First Search)

```typescript
import { bfs } from 'kc-graph';

for (const { node, depth, parentId } of bfs(graph, 'src/auth.ts#login', {
  maxDepth: 3,
  direction: 'outbound',
  edgeTypes: ['calls'],
})) {
  console.log(`${' '.repeat(depth * 2)}${node.name} (depth: ${depth})`);
}
```

### DFS (Depth-First Search)

```typescript
import { dfs } from 'kc-graph';

for (const { node, depth } of dfs(graph, startId)) {
  // Process each node
}
```

### k-Hop Neighborhood

Get all nodes within k edges of seed nodes:

```typescript
import { kHopNeighborhood } from 'kc-graph';

const nearby = kHopNeighborhood(graph, ['src/auth.ts#login'], 2);
```

## Impact Analysis

The killer feature for code review — traces what would be affected by a change:

```typescript
import { analyzeImpact, formatImpactSummary } from 'kc-graph';

const result = analyzeImpact(graph, 'utils.ts#validate', {
  maxDepth: 5,
  direction: 'dependents',  // who uses this?
});

// Structured result
console.log(result.stats.totalImpacted);  // 12
console.log(result.stats.fileCount);       // 4

// Formatted summary for AI
console.log(formatImpactSummary(result));
```

## Subgraph Extraction

Extract a portion of the graph:

```typescript
import { extractSubgraph } from 'kc-graph';

const sub = extractSubgraph(graph, ['src/auth.ts#login'], {
  maxDepth: 2,
  edgeTypes: ['calls', 'contains'],
  nodeTypes: ['function', 'class'],
});

// sub is a new CodeGraph instance
console.log(sub.nodeCount);
```
