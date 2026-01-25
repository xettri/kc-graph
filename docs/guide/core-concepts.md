# Core Concepts

## The Code Graph

kc-graph represents your codebase as a **directed graph** where:

- **Nodes** are code entities (files, functions, classes, variables, types, docs)
- **Edges** are relationships between them (contains, calls, imports, extends, etc.)

This structure lets AI agents navigate your code by following relationships instead of reading entire files.

## Node Types

| Type | Description | Example |
|------|-------------|---------|
| `file` | A source file | `src/auth.ts` |
| `module` | A module/namespace | `@app/auth` |
| `class` | A class definition | `class UserService` |
| `function` | A function or method | `function login()` |
| `variable` | A variable/constant | `const MAX_RETRIES = 3` |
| `type` | A type or interface | `interface User` |
| `doc` | Documentation | README section, JSDoc block |
| `snippet` | A code snippet | Inline code for RAG |

Every node has:
- **id** — unique identifier (typically `filePath#symbolName`)
- **name** — human-readable name
- **content** — the actual source code or text
- **signature** — function/type signature
- **location** — file path and line numbers
- **embedding** — optional `Float32Array` for semantic search

## Edge Types

| Type | Meaning | Example |
|------|---------|---------|
| `contains` | Parent contains child | File contains function |
| `calls` | A calls B | `login()` calls `validate()` |
| `imports` | A imports from B | File imports from module |
| `extends` | A extends B | `AdminUser extends User` |
| `implements` | A implements B | `AuthService implements IAuth` |
| `references` | A references B | Function uses variable |
| `exports` | A exports B | File exports function |
| `depends_on` | A depends on B | Module dependency |
| `documents` | A documents B | Doc describes function |
| `tagged_with` | A tagged with B | Entity has category |

## Identifiers

kc-graph uses **qualified names** as node IDs:

```
src/auth.ts                    → file node
src/auth.ts#login              → function node
src/auth.ts#AuthService        → class node
src/auth.ts#AuthService.verify → method node
```

The `graph.resolve()` method accepts any of: full ID, qualified name, or plain symbol name.

## Indexes

The graph maintains several indexes for fast lookups:

- **By type** — `graph.findByType('function')` → O(1)
- **By file** — `graph.findByFile('src/auth.ts')` → O(1)
- **By name** — `graph.findByName('login')` → O(1), case-insensitive
- **Adjacency** — `graph.getSuccessors(id)` / `graph.getPredecessors(id)` → O(edges)

## V8 Optimizations

kc-graph is designed for maximum V8 engine performance:

1. **Monomorphic hidden classes** — All nodes use the same interface shape. V8 assigns one hidden class to all CodeNode objects, keeping property lookups fast via inline caching.

2. **Map over Object** — `Map<string, T>` is 2-5x faster than plain objects for frequent insertions and deletions of dynamic keys.

3. **Float32Array** — Embeddings use typed arrays: 4x less memory than `number[]`, and eligible for SIMD optimization by TurboFan.

4. **Integer timestamps** — `Date.now()` returns a number. We never create `Date` objects (avoids heap allocation).

5. **Generator-based traversal** — BFS/DFS use generators for lazy evaluation. If you only need the first 10 results, only 10 nodes are visited.

6. **Array-backed BFS queue** — Uses a head pointer instead of `Array.shift()`, avoiding O(n) moves on each dequeue.
