import { toolDefinitions, createToolHandlers } from './tools.js';
import type { ProjectMap } from './tools.js';

/** MCP stdio server (JSON-RPC 2.0 with Content-Length framing). */
export function startMcpServer(projects: ProjectMap): void {
  const handlers = createToolHandlers(projects);
  let buffer = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    processBuffer();
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  function processBuffer(): void {
    // MCP uses Content-Length framing
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Not a valid header — try to find next message
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) break; // wait for more data

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body);
        handleMessage(message);
      } catch {
        // Malformed JSON — send parse error per JSON-RPC spec
        sendError(null, -32700, 'Parse error: invalid JSON');
      }
    }
  }

  function handleMessage(msg: JsonRpcMessage): void {
    if (!msg.method) return; // responses/notifications we ignore

    switch (msg.method) {
      case 'initialize':
        sendResponse(msg.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'kc-graph',
            version: '0.1.0',
          },
        });
        break;

      case 'notifications/initialized':
        // Client confirmed initialization — nothing to do
        break;

      case 'tools/list':
        sendResponse(msg.id, {
          tools: Object.values(toolDefinitions).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
        break;

      case 'tools/call': {
        const toolName = msg.params?.name as string;
        const toolArgs = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        const handler = handlers[toolName];

        if (!handler) {
          sendResponse(msg.id, {
            content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
            isError: true,
          });
          break;
        }

        try {
          const result = handler(toolArgs);
          sendResponse(msg.id, result);
        } catch (err) {
          sendResponse(msg.id, {
            content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
            isError: true,
          });
        }
        break;
      }

      case 'ping':
        sendResponse(msg.id, {});
        break;

      default:
        // Unknown method — return error
        if (msg.id !== undefined) {
          sendError(msg.id, -32601, `Method not found: ${msg.method}`);
        }
        break;
    }
  }

  function sendResponse(id: number | string | undefined, result: unknown): void {
    if (id === undefined) return; // notification, no response needed
    send({ jsonrpc: '2.0', id, result });
  }

  function sendError(id: number | string | null | undefined, code: number, message: string): void {
    if (id === undefined) return;
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  function send(msg: object): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    process.stdout.write(header + body);
  }
}

interface JsonRpcMessage {
  jsonrpc: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}
