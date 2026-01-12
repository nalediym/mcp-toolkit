/**
 * JSON-RPC MCP Server (Baseline)
 * Uses the official @modelcontextprotocol/sdk
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'json-rpc-benchmark-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Simple echo tool - minimal processing to isolate transport overhead
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'echo',
        description: 'Returns the input back',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
          required: ['message'],
        },
      },
      {
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
      },
      {
        name: 'large_response',
        description: 'Returns a large payload',
        inputSchema: {
          type: 'object',
          properties: {
            size: { type: 'number' },
          },
          required: ['size'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'echo':
      return {
        content: [
          {
            type: 'text',
            text: (args as { message: string }).message,
          },
        ],
      };

    case 'compute':
      const { a, b } = args as { a: number; b: number };
      return {
        content: [
          {
            type: 'text',
            text: String(a + b),
          },
        ],
      };

    case 'large_response':
      const { size } = args as { size: number };
      const data = 'x'.repeat(size);
      return {
        content: [
          {
            type: 'text',
            text: data,
          },
        ],
      };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('JSON-RPC MCP server running on stdio');
}

main().catch(console.error);
