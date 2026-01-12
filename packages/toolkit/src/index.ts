/**
 * mcp-performance
 *
 * Performance toolkit for Model Context Protocol - batching, caching, pooling, and profiling utilities.
 *
 * This package provides transport-agnostic utilities to optimize MCP workflows:
 *
 * - **Batcher**: Combine multiple tool calls into batched requests
 * - **Cacher**: Cache tool/resource/prompt definitions to avoid repeated fetches
 * - **Pooler**: Manage a pool of MCP connections for reuse
 * - **Profiler**: Measure where time goes in MCP workflows
 *
 * @example
 * ```typescript
 * import {
 *   McpCallBatcher,
 *   ToolDefinitionCacher,
 *   McpConnectionPool,
 *   McpProfiler,
 * } from 'mcp-performance';
 *
 * // Create a profiler to measure performance
 * const profiler = new McpProfiler();
 * const session = profiler.startSession('my-workflow');
 *
 * // Set up connection pooling
 * const pool = new McpConnectionPool({
 *   factory: async (options) => createMyConnection(options),
 *   maxConnections: 10,
 * });
 *
 * // Set up caching for tool definitions
 * const cacher = new ToolDefinitionCacher({
 *   fetchTools: () => pool.withConnection({ url }, (c) => c.listTools()),
 *   ttlMs: 60000,
 * });
 *
 * // Set up batching for tool calls
 * const batcher = new McpCallBatcher({
 *   executor: async (calls) => {
 *     return pool.withConnection({ url }, async (conn) => {
 *       return Promise.all(calls.map(c => conn.callTool(c.name, c.args)));
 *     });
 *   },
 * });
 *
 * // Use them in your workflow
 * await session.time('get-tools', () => cacher.getTools());
 *
 * const results = await session.time('batch-calls', () =>
 *   Promise.all([
 *     batcher.call('tool1', { arg: 1 }),
 *     batcher.call('tool2', { arg: 2 }),
 *   ])
 * );
 *
 * // Get performance report
 * const report = session.end();
 * profiler.printReport(report);
 * ```
 *
 * @packageDocumentation
 */

// Types
export type {
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  ContentItem,
  ToolCallResult,
  PendingToolCall,
  BatcherStats,
  CacheStats,
  PoolStats,
  ConnectionOptions,
  McpConnection,
  ConnectionFactory,
  TimingEntry,
  ProfilerReport,
} from './types.js';

// Batcher
export {
  McpCallBatcher,
  createParallelExecutor,
  withBatching,
  type BatcherOptions,
} from './batcher.js';

// Cacher
export {
  ToolDefinitionCacher,
  MemoryStorageAdapter,
  withCaching,
  type CacherOptions,
  type FetchOptions,
  type StorageAdapter,
} from './cacher.js';

// Pooler
export {
  McpConnectionPool,
  wrapMcpClient,
  createLoadBalancer,
  type PoolOptions,
} from './pooler.js';

// Profiler
export {
  McpProfiler,
  ProfilingSession,
  profileMcpClient,
  createProfilingMiddleware,
  createMeasure,
} from './profiler.js';
