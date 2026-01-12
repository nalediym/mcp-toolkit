export { McpServer } from './server.js';
export type {
  McpServerOptions,
  ToolDefinition,
  ToolHandler,
  ResourceDefinition,
  ResourceHandler,
  PromptDefinition,
  PromptHandler,
} from './types.js';

// Re-export commonly used types from proto
export {
  Tool,
  Resource,
  Prompt,
  Content,
  TextContent,
  Role,
} from '@grpc-mcp/proto';
