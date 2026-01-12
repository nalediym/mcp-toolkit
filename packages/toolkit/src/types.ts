/**
 * MCP Toolkit Types
 *
 * Generic types that work with any MCP client implementation.
 * These types are designed to be transport-agnostic.
 */

/**
 * Represents a tool definition from an MCP server
 */
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Represents a resource definition from an MCP server
 */
export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Represents a prompt definition from an MCP server
 */
export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * Content returned from tool calls
 */
export interface ContentItem {
  type: 'text' | 'image' | 'audio' | 'resource';
  text?: string;
  data?: Uint8Array;
  mimeType?: string;
  uri?: string;
}

/**
 * Result of a tool call
 */
export interface ToolCallResult {
  content: ContentItem[];
  isError: boolean;
}

/**
 * A pending tool call in a batch
 */
export interface PendingToolCall {
  name: string;
  args: Record<string, unknown>;
  resolve: (result: ToolCallResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Statistics about batching performance
 */
export interface BatcherStats {
  totalCalls: number;
  totalBatches: number;
  averageBatchSize: number;
  callsSaved: number; // calls that were batched vs individual
}

/**
 * Statistics about cache performance
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  entries: number;
  bytesUsed: number;
}

/**
 * Statistics about connection pool
 */
export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalCreated: number;
  totalReused: number;
}

/**
 * Options for creating a connection
 */
export interface ConnectionOptions {
  /** Server URL */
  url: string;
  /** Additional options */
  [key: string]: unknown;
}

/**
 * A generic MCP connection interface
 * Implementations should wrap their specific client
 */
export interface McpConnection {
  /** Unique identifier for this connection */
  id: string;
  /** Whether the connection is currently in use */
  inUse: boolean;
  /** When the connection was created */
  createdAt: number;
  /** When the connection was last used */
  lastUsedAt: number;
  /** Call a tool */
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  /** List tools */
  listTools(): Promise<ToolDefinition[]>;
  /** List resources */
  listResources(): Promise<ResourceDefinition[]>;
  /** List prompts */
  listPrompts(): Promise<PromptDefinition[]>;
  /** Check if connection is healthy */
  ping(): Promise<boolean>;
  /** Close the connection */
  close(): Promise<void>;
}

/**
 * Factory function to create connections
 */
export type ConnectionFactory = (options: ConnectionOptions) => Promise<McpConnection>;

/**
 * Profiler timing entry
 */
export interface TimingEntry {
  name: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
  children: TimingEntry[];
}

/**
 * Profiler report
 */
export interface ProfilerReport {
  totalDuration: number;
  entries: TimingEntry[];
  summary: {
    [operation: string]: {
      count: number;
      totalTime: number;
      avgTime: number;
      minTime: number;
      maxTime: number;
    };
  };
}
