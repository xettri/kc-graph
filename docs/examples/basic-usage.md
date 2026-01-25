# Basic Usage

## Build a Graph Manually

```typescript
import { CodeGraph } from 'kc-graph';

const graph = new CodeGraph();

// Add nodes
graph.addNode({
  type: 'file',
  name: 'math.ts',
  qualifiedName: 'src/math.ts',
  location: { file: 'src/math.ts', startLine: 1, endLine: 30, startColumn: 0, endColumn: 0 },
});

graph.addNode({
  type: 'function',
  name: 'add',
  qualifiedName: 'src/math.ts#add',
  content: 'function add(a: number, b: number): number { return a + b; }',
  signature: 'function add(a: number, b: number): number',
  location: { file: 'src/math.ts', startLine: 1, endLine: 3, startColumn: 0, endColumn: 0 },
});

graph.addNode({
  type: 'function',
  name: 'multiply',
  qualifiedName: 'src/math.ts#multiply',
  content: 'function multiply(a: number, b: number): number { return a * b; }',
  signature: 'function multiply(a: number, b: number): number',
  location: { file: 'src/math.ts', startLine: 5, endLine: 7, startColumn: 0, endColumn: 0 },
});

// Add relationships
graph.addEdge({ source: 'src/math.ts', target: 'src/math.ts#add', type: 'contains' });
graph.addEdge({ source: 'src/math.ts', target: 'src/math.ts#multiply', type: 'contains' });

// Query
console.log(graph.nodeCount);  // 3
console.log(graph.findByType('function').length);  // 2
```

## Parse a Source File

```typescript
import { CodeGraph, indexSourceFile } from 'kc-graph';

const graph = new CodeGraph();

const source = `
export interface User {
  id: string;
  name: string;
  email: string;
}

export class UserService {
  private users: Map<string, User> = new Map();

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(name: string, email: string): Promise<User> {
    const user = { id: crypto.randomUUID(), name, email };
    this.users.set(user.id, user);
    return user;
  }
}
`;

indexSourceFile(graph, 'src/user.ts', source);

// Find the class
const userService = graph.resolve('UserService');
console.log(userService?.type);      // "class"
console.log(userService?.signature); // "class UserService"

// Find its methods
const methods = graph.getSuccessors(userService!.id, ['contains']);
console.log(methods.map(m => m.name)); // ["getUser", "createUser"]
```

## Save and Load

```typescript
import { saveToFile, loadFromFile } from 'kc-graph';

// Save
await saveToFile(graph, '.kc-graph.json');

// Load (in a later session)
const restored = await loadFromFile('.kc-graph.json');
console.log(restored.nodeCount); // same as before
```
