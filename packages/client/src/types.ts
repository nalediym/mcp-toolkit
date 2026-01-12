import type { Transport } from '@connectrpc/connect';
import type {
  Implementation,
  ClientCapabilities,
  ServerCapabilities,
} from '@grpc-mcp/proto';

export interface McpClientOptions {
  /** Client name and version */
  clientInfo: Implementation;

  /** Capabilities to advertise */
  capabilities?: ClientCapabilities;

  /** Connection timeout in milliseconds */
  timeout?: number;
}

export interface TransportOptions {
  /** Server URL (e.g., "http://localhost:50051") */
  baseUrl: string;

  /** Use HTTP/2 (default: true for gRPC, false for Connect) */
  http2?: boolean;
}

export interface ConnectedSession {
  /** Server information */
  serverInfo: Implementation;

  /** Server capabilities */
  capabilities: ServerCapabilities;

  /** Protocol version */
  protocolVersion: string;

  /** Server instructions */
  instructions?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ToolCallResult {
  content: ContentItem[];
  isError: boolean;
}

export interface ContentItem {
  type: 'text' | 'image' | 'audio' | 'resource';
  text?: string;
  data?: Uint8Array;
  mimeType?: string;
  uri?: string;
}
