import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createToolHandlers, toolDefinitions } from './tools.js';
import type { ProjectMap } from './tools.js';
import { DEFAULT_SCOPE } from '../storage/scope.js';
import { createRefresher } from './reload.js';

export interface McpServerOptions {
  scope?: string;
  storePaths?: Map<string, string>;
}

/** Start MCP server over stdio. */
export async function startMcpServer(
  projects: ProjectMap,
  options?: string | McpServerOptions,
): Promise<void> {
  const opts: McpServerOptions = typeof options === 'string' ? { scope: options } : (options ?? {});
  const { scope, storePaths } = opts;

  const handlers = createToolHandlers(projects, scope);

  const refresh = storePaths && storePaths.size > 0 ? createRefresher(projects, storePaths) : null;

  const serverName = scope && scope !== DEFAULT_SCOPE ? `kc-graph (${scope})` : 'kc-graph';

  const mcpServer = new McpServer(
    { name: serverName, version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const server = mcpServer.server;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(toolDefinitions).map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];

    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      } as Record<string, unknown>;
    }

    try {
      refresh?.();

      const result = handler(args ?? {});
      return { ...result } as Record<string, unknown>;
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      } as Record<string, unknown>;
    }
  });

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
