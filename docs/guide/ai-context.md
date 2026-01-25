# AI Context Builder

The context builder is the core value proposition of kc-graph. It extracts the most relevant code context within a token budget.

## How It Works

1. **Seed nodes** — start from the symbols you're interested in
2. **Expand** — follow graph edges to discover related code
3. **Score** — rank each neighbor by relevance (distance + edge type + embedding similarity)
4. **Budget** — greedily add highest-scored nodes until the token budget is exhausted
5. **Format** — produce structured text grouped by file

## Basic Usage

```typescript
import { buildContext } from 'kc-graph';

const result = buildContext(graph, ['src/auth.ts#login'], {
  maxTokens: 2000,        // Token budget
  includeSignatures: true, // Show signatures for related code (saves tokens)
  includeDoc: true,        // Include linked documentation
  depth: 3,                // How many hops to expand
});

console.log(result.context);          // Formatted text for AI
console.log(result.estimatedTokens);  // Token estimate
console.log(result.files);            // Files included
console.log(result.nodes.length);     // Nodes included
```

## Consumer-Friendly API

For MCP tools and external consumers:

```typescript
import { getContextForSymbol, getContextForFile } from 'kc-graph';

// By symbol name (no graph internals exposed)
const ctx = getContextForSymbol(graph, 'login', {
  maxTokens: 4000,
  file: 'src/auth.ts',  // optional: narrow lookup
});

// By file
const fileCtx = getContextForFile(graph, 'src/auth.ts', {
  maxTokens: 4000,
});
```

## Output Format

The context is formatted for AI consumption:

```
--- src/auth.ts ---
[TARGET] function login:5
  signature: async function login(user: string, pass: string): Promise<Token>
async function login(user: string, pass: string): Promise<Token> {
  const valid = validate(user, pass);
  return generateToken(user);
}

function validate:10
  signature: function validate(user: string, pass: string): boolean

function generateToken:14
  signature: function generateToken(user: string): Token

--- Related Documentation ---
doc: Auth Guide
The login function handles user authentication.
```

Seed nodes get full content (`[TARGET]` prefix). Related nodes get just their signature to save tokens.

## Token Estimation

Tokens are estimated as `content.length / 4` — a good approximation for code. The builder ensures `estimatedTokens <= maxTokens`.

## Relevance Scoring

Each candidate node is scored by combining:

| Component | Weight | Description |
|-----------|--------|-------------|
| Distance | 0.4 | `1 / (1 + graphDistance)` — closer = more relevant |
| Edge type | 0.3 | `calls` > `imports` > `references` > `tagged_with` |
| Embedding | 0.3 | Cosine similarity (if embeddings are set) |

Custom weights:

```typescript
import { rankByRelevance } from 'kc-graph';

const ranked = rankByRelevance(graph, ['src/auth.ts#login'], 3, {
  distance: 0.5,
  edgeType: 0.3,
  embedding: 0.2,
});
```

## Embeddings

Set embeddings from your preferred model (OpenAI, Cohere, local model, etc.):

```typescript
import { setEmbedding, findSimilar } from 'kc-graph';

// Set embedding on a node
setEmbedding(graph, 'login', new Float32Array([0.1, 0.2, ...]));

// Find similar code
const similar = findSimilar(graph, queryVector, 10, 0.5);
```

kc-graph uses brute-force cosine similarity with a V8-optimized, loop-unrolled implementation. For typical codebases (<100k nodes), this is fast enough without external indexes.
