/**
 * gRPC MCP Server (Our Implementation)
 */

import { McpServer } from '@grpc-mcp/server';

const server = new McpServer({
  name: 'grpc-benchmark-server',
  version: '1.0.0',
});

// Simple echo tool - minimal processing to isolate transport overhead
server.addTool({
  name: 'echo',
  description: 'Returns the input back',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  handler: async ({ message }) => ({
    content: [{ type: 'text', text: message as string }],
  }),
});

server.addTool({
  name: 'compute',
  description: 'Performs a simple computation',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['a', 'b'],
  },
  handler: async ({ a, b }) => ({
    content: [{ type: 'text', text: String((a as number) + (b as number)) }],
  }),
});

server.addTool({
  name: 'large_response',
  description: 'Returns a large payload',
  inputSchema: {
    type: 'object',
    properties: {
      size: { type: 'number' },
    },
    required: ['size'],
  },
  handler: async ({ size }) => ({
    content: [{ type: 'text', text: 'x'.repeat(size as number) }],
  }),
});

const PORT = parseInt(process.env.GRPC_PORT ?? '50051', 10);

server.listen({ port: PORT }).then(() => {
  console.error(`gRPC MCP server running on port ${PORT}`);
});
