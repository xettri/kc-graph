# Contributing to kc-graph

We welcome contributions! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/xettri/kc-graph.git
cd kc-graph
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Build ESM + CJS outputs |
| `npm run lint` | Lint source and test files |
| `npm run format` | Format with Prettier |
| `npm run typecheck` | Type-check without emitting |
| `npm run docs:dev` | Start docs dev server |

## Code Style

- TypeScript strict mode
- Prettier for formatting (auto-applied on save)
- Prefer `Map` over plain objects for dynamic key collections
- Prefer generators for lazy iteration
- Avoid class hierarchies — use interfaces with type discriminators
- Keep V8 hidden classes stable (consistent property initialization order)

## Testing

All changes must include tests. We use Vitest:

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # Coverage report
```

## Pull Requests

1. Fork and create a feature branch
2. Make your changes with tests
3. Ensure `npm test && npm run build && npm run lint` passes
4. Submit a PR with a clear description

## Architecture

```
src/
  core/         — Graph data structure, types, node/edge factories
  parser/       — TypeScript AST parser, markdown doc parser
  operations/   — Traversal, query, impact analysis, subgraph extraction
  ai/           — Context builder, embeddings, relevance scoring
  serialization/ — JSON import/export, file persistence
  mcp/          — MCP tool definitions and handlers
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
