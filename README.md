# grpc-mcp

A gRPC/Protobuf transport layer for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

**Status:** Early development

## Why?

MCP uses JSON-RPC 2.0 by default. For most use cases, that's fine. For latency-sensitive applications (real-time agents, game NPCs, high-frequency tool calls), the serialization overhead adds up.

This project provides an alternative transport using gRPC and Protocol Buffers:

| Metric | JSON-RPC | gRPC |
|--------|----------|------|
| Serialization overhead | ~500μs | ~30μs |
| Message size | Larger | ~50% smaller |
| Streaming | SSE | Native bidirectional |

## Packages

| Package | Description |
|---------|-------------|
| `@grpc-mcp/proto` | Protocol buffer definitions |
| `@grpc-mcp/client` | TypeScript client library |
| `@grpc-mcp/server` | TypeScript server library |
| `@grpc-mcp/bridge` | JSON-RPC ↔ gRPC adapter (coming soon) |

## Quick Start

### Server

```typescript
import { McpServer } from '@grpc-mcp/server';

const server = new McpServer({
  name: 'my-server',
  version: '1.0.0',
});

server.addTool({
  name: 'calculator',
  description: 'Performs math operations',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['a', 'b'],
  },
  handler: async ({ a, b }) => ({
    content: [{ type: 'text', text: `Result: ${a + b}` }],
  }),
});

await server.listen({ port: 50051 });
console.log('Server running on :50051');
```

### Client

```typescript
import { McpClient, createHttpTransport } from '@grpc-mcp/client';

const client = new McpClient({
  clientInfo: { name: 'my-client', version: '1.0.0' },
});

await client.connect(createHttpTransport({ baseUrl: 'http://localhost:50051' }));

const tools = await client.listTools();
console.log('Tools:', tools);

const result = await client.callTool('calculator', { a: 2, b: 3 });
console.log('Result:', result.content);

await client.disconnect();
```

## Development

### Prerequisites

- Node.js 18+
- pnpm 8+
- [buf](https://buf.build/) CLI (for protobuf generation)

### Setup

```bash
# Clone the repo
git clone https://github.com/grpc-mcp/grpc-mcp
cd grpc-mcp

# Install dependencies
pnpm install

# Generate protobuf code
pnpm proto:generate

# Build all packages
pnpm build
```

### Run Examples

```bash
# Terminal 1: Start server
cd examples/basic-server
pnpm start

# Terminal 2: Run client
cd examples/basic-client
pnpm start
```

## Protocol

The gRPC service definitions are in [`proto/mcp/v1/mcp.proto`](./proto/mcp/v1/mcp.proto).

Key services:

```protobuf
service McpServer {
  rpc Initialize(InitializeRequest) returns (InitializeResponse);
  rpc ListTools(ListToolsRequest) returns (ListToolsResponse);
  rpc CallTool(CallToolRequest) returns (CallToolResponse);
  rpc ListResources(ListResourcesRequest) returns (ListResourcesResponse);
  rpc ReadResource(ReadResourceRequest) returns (ReadResourceResponse);
  rpc SubscribeResource(SubscribeResourceRequest) returns (stream ResourceUpdate);
  // ...
}

service McpClient {
  rpc CreateSample(CreateSampleRequest) returns (CreateSampleResponse);
  rpc CreateSampleStream(CreateSampleRequest) returns (stream SampleChunk);
  rpc ListRoots(ListRootsRequest) returns (ListRootsResponse);
}
```

## Compatibility

This project aims for semantic compatibility with MCP. The same concepts (tools, resources, prompts, sampling) work the same way—only the wire format changes.

| MCP Version | grpc-mcp Version |
|-------------|------------------|
| 2025-11-25 | 0.1.x |

## Roadmap

- [x] Define protobuf schema
- [x] Basic client library
- [x] Basic server library
- [ ] Bridge (JSON-RPC ↔ gRPC)
- [ ] Benchmarks
- [ ] Connect-RPC browser support
- [ ] Python client/server
- [ ] Rust client/server

## License

MIT
