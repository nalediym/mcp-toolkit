import type { Implementation, ServerCapabilities } from '@grpc-mcp/proto';

export interface McpServerOptions {
  /** Server name */
  name: string;

  /** Server version */
  version: string;

  /** Optional instructions to provide to clients */
  instructions?: string;
}

export interface ToolDefinition {
  /** Tool name (unique identifier) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for input arguments */
  inputSchema: JsonSchema;

  /** Tool handler function */
  handler: ToolHandler;
}

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<ToolResult> | ToolResult;

export interface ToolResult {
  content: ContentResult[];
  isError?: boolean;
}

export interface ContentResult {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: Uint8Array;
  mimeType?: string;
  uri?: string;
}

export interface ResourceDefinition {
  /** Resource URI */
  uri: string;

  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** MIME type */
  mimeType?: string;

  /** Handler to read the resource */
  handler: ResourceHandler;
}

export type ResourceHandler = () => Promise<ResourceContent> | ResourceContent;

export interface ResourceContent {
  text?: string;
  blob?: Uint8Array;
  mimeType?: string;
}

export interface PromptDefinition {
  /** Prompt name (unique identifier) */
  name: string;

  /** Description */
  description?: string;

  /** Arguments the prompt accepts */
  arguments?: PromptArgumentDef[];

  /** Handler to generate prompt messages */
  handler: PromptHandler;
}

export interface PromptArgumentDef {
  name: string;
  description?: string;
  required?: boolean;
}

export type PromptHandler = (
  args: Record<string, string>
) => Promise<PromptResult> | PromptResult;

export interface PromptResult {
  description?: string;
  messages: PromptMessageResult[];
}

export interface PromptMessageResult {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentResult[];
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  items?: JsonSchema;
  enum?: string[];
  [key: string]: unknown;
}
