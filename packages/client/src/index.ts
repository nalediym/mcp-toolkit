export { McpClient } from './client.js';
export { createGrpcTransport, createHttpTransport } from './transport.js';
export type { McpClientOptions, TransportOptions } from './types.js';

// Re-export commonly used types from proto
export {
  Tool,
  Resource,
  Prompt,
  Content,
  TextContent,
  Role,
  StopReason,
} from '@grpc-mcp/proto';
