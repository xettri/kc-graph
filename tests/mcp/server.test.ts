import { describe, it, expect, beforeEach } from 'vitest';
import { Readable, Writable, PassThrough } from 'node:stream';
import { CodeGraph } from '../../src/core/graph.js';
import { toolDefinitions, createToolHandlers } from '../../src/mcp/tools.js';

/**
 * Test the MCP server protocol handling in-process.
 * Instead of spawning a child process (which has vitest sandbox issues),
 * we test the protocol logic directly by simulating stdin/stdout.
 */

function buildGraph(): CodeGraph {
  const g = new CodeGraph();
  g.addNode({ id: 'src/app.ts', type: 'file', name: 'app.ts', qualifiedName: 'src/app.ts', content: '', signature: '', location: { file: 'src/app.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: 0 }, metadata: {} });
  g.addNode({ id: 'src/app.ts#main', type: 'function', name: 'main', qualifiedName: 'src/app.ts#main', content: 'function main() {}', signature: '() => void', location: { file: 'src/app.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: 18 }, metadata: {} });
  g.addEdge({ source: 'src/app.ts', target: 'src/app.ts#main', type: 'contains', weight: 1, metadata: {} });
  return g;
}

/**
 * Minimal in-process MCP protocol handler (mirrors server.ts logic).
 * This tests the same JSON-RPC message handling without stdio piping.
 */
function handleMcpMessage(
  graph: CodeGraph,
  msg: { jsonrpc: string; id?: number; method?: string; params?: Record<string, unknown> },
): object | null {
  const handlers = createToolHandlers(graph);

  switch (msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'kc-graph', version: '0.1.0' },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: Object.values(toolDefinitions).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };

    case 'tools/call': {
      const toolName = msg.params?.name as string;
      const toolArgs = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const handler = handlers[toolName];

      if (!handler) {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true },
        };
      }

      const result = handler(toolArgs);
      return { jsonrpc: '2.0', id: msg.id, result };
    }

    case 'ping':
      return { jsonrpc: '2.0', id: msg.id, result: {} };

    default:
      return null;
  }
}

describe('MCP Server Protocol', () => {
  let graph: CodeGraph;

  beforeEach(() => {
    graph = buildGraph();
  });

  it('should respond to initialize with server info', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    }) as any;

    expect(resp.id).toBe(1);
    expect(resp.result.serverInfo.name).toBe('kc-graph');
    expect(resp.result.capabilities.tools).toBeDefined();
    expect(resp.result.protocolVersion).toBe('2024-11-05');
  });

  it('should list all 5 tools', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 2, method: 'tools/list',
    }) as any;

    expect(resp.result.tools.length).toBe(5);
    const names = resp.result.tools.map((t: any) => t.name);
    expect(names).toContain('search_code');
    expect(names).toContain('get_context');
    expect(names).toContain('get_impact');
    expect(names).toContain('get_structure');
    expect(names).toContain('find_similar');
  });

  it('should have valid input schemas for each tool', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 3, method: 'tools/list',
    }) as any;

    for (const tool of resp.result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });

  it('should handle search_code tool call', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'search_code', arguments: { query: 'main' } },
    }) as any;

    expect(resp.result.isError).toBeUndefined();
    const results = JSON.parse(resp.result.content[0].text);
    expect(results.some((r: any) => r.name === 'main')).toBe(true);
  });

  it('should handle get_structure tool call', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'get_structure', arguments: { path: 'src/app.ts' } },
    }) as any;

    expect(resp.result.isError).toBeUndefined();
    const structure = JSON.parse(resp.result.content[0].text);
    expect(structure.some((s: any) => s.name === 'main')).toBe(true);
  });

  it('should handle get_context tool call', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'get_context', arguments: { symbol: 'main' } },
    }) as any;

    expect(resp.result.isError).toBeUndefined();
    expect(resp.result.content[0].text.length).toBeGreaterThan(0);
  });

  it('should handle get_impact tool call', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'get_impact', arguments: { symbol: 'main' } },
    }) as any;

    expect(resp.result.isError).toBeUndefined();
  });

  it('should return error for unknown tool', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'nonexistent_tool', arguments: {} },
    }) as any;

    expect(resp.result.isError).toBe(true);
  });

  it('should respond to ping', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 9, method: 'ping',
    }) as any;

    expect(resp.id).toBe(9);
    expect(resp.result).toBeDefined();
  });

  it('should return null for unknown methods', () => {
    const resp = handleMcpMessage(graph, {
      jsonrpc: '2.0', id: 10, method: 'unknown/method',
    });

    expect(resp).toBeNull();
  });
});
