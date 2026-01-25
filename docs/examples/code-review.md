# Code Review with Impact Analysis

This example shows how an AI code reviewer can use kc-graph to understand the impact of code changes.

## Scenario

A developer changes the `validate` function in `utils.ts`. The AI needs to know what else might break.

## Implementation

```typescript
import {
  CodeGraph,
  indexSourceFile,
  analyzeImpact,
  formatImpactSummary,
  getContextForSymbol,
} from 'kc-graph';
import { readFileSync } from 'fs';

// Build the graph from source files
const graph = new CodeGraph();
const files = ['src/utils.ts', 'src/auth.ts', 'src/api.ts', 'src/router.ts'];

for (const file of files) {
  indexSourceFile(graph, file, readFileSync(file, 'utf-8'));
}

// Developer changed 'validate' — analyze impact
const impact = analyzeImpact(graph, graph.resolve('validate')!.id, {
  maxDepth: 5,
  direction: 'dependents',
});

console.log(formatImpactSummary(impact));
// Output:
// Impact analysis for: validate (function)
// Total impacted: 3 nodes across 3 files
//   src/auth.ts:
//     login (function) - distance: 1, via: calls
//   src/api.ts:
//     handleRequest (function) - distance: 2, via: calls → calls
//   src/router.ts:
//     route (function) - distance: 3, via: calls → calls → calls

// Get full context for the changed function + its callers
const context = getContextForSymbol(graph, 'validate', {
  maxTokens: 3000,
  includeSignatures: true,
  includeDoc: true,
  depth: 2,
});

// Send to AI for review
console.log(context!.context);
console.log(`Context uses ~${context!.estimatedTokens} tokens`);
```

## AI Review Workflow

1. Parse the changed files into the graph
2. For each changed function, run `analyzeImpact`
3. Get `getContextForSymbol` for each impacted area
4. Send the structured context to the AI reviewer
5. AI can see exactly what depends on the change and how
