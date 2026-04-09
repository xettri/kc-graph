# kc-graph

[![npm]](https://www.npmjs.com/package/kc-graph)

[npm]: https://img.shields.io/npm/v/kc-graph.svg?style=flat-square

Code intelligence graph for AI-optimized context retrieval — maps codebases at module/function/variable level so AI agents get exactly the context they need.

**Learn more in the [documentation](https://xettri.github.io/kc-graph/)**.

## Get started

1. Install kc-graph:

   ```bash
   npm install -g kc-graph
   ```

2. Index your project and start the MCP server:

   ```bash
   kc-graph init
   kc-graph mcp
   ```

3. Add to Claude Code:

   ```bash
   claude mcp add kc-graph -- kc-graph mcp
   ```

For multi-project setup, scoped environments, and programmatic API, see the [documentation](https://xettri.github.io/kc-graph/guide/getting-started).
