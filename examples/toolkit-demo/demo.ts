/**
 * MCP Performance Toolkit - Complete Demo
 *
 * This demo shows how to combine all toolkit utilities for maximum performance:
 * - Connection pooling for reuse
 * - Tool definition caching to avoid repeated fetches
 * - Call batching to reduce round-trips
 * - Profiling to measure everything
 */

import {
  McpCallBatcher,
  createParallelExecutor,
  ToolDefinitionCacher,
  McpConnectionPool,
  wrapMcpClient,
  McpProfiler,
  type McpConnection,
  type ToolCallResult,
  type ToolDefinition,
  type ConnectionOptions,
} from 'mcp-performance';

// ═══════════════════════════════════════════════════════════════════════════
// Simulated MCP Client (replace with real implementation)
// ═══════════════════════════════════════════════════════════════════════════

class SimulatedMcpClient {
  private url: string;
  private connectionTime: number;
  private callTime: number;

  constructor(url: string, connectionTime = 100, callTime = 30) {
    this.url = url;
    this.connectionTime = connectionTime;
    this.callTime = callTime;
  }

  async connect(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.connectionTime));
  }

  async listTools(): Promise<ToolDefinition[]> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return [
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
      { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object' } },
      { name: 'search', description: 'Search files', inputSchema: { type: 'object' } },
      { name: 'analyze', description: 'Analyze code', inputSchema: { type: 'object' } },
    ];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    await new Promise((resolve) => setTimeout(resolve, this.callTime));
    return {
      content: [{ type: 'text', text: `Result from ${name}` }],
      isError: false,
    };
  }

  async ping(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async disconnect(): Promise<void> {
    // Cleanup
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Demo
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║         MCP Performance Toolkit - Complete Demo               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  const SERVER_URL = 'http://localhost:50051';

  // ─────────────────────────────────────────────────────────────
  // Step 1: Set up profiler to measure everything
  // ─────────────────────────────────────────────────────────────

  console.log('Step 1: Setting up profiler');
  console.log('─'.repeat(60));

  const profiler = new McpProfiler();
  const session = profiler.startSession('complete-workflow');

  // ─────────────────────────────────────────────────────────────
  // Step 2: Set up connection pool
  // ─────────────────────────────────────────────────────────────

  console.log('Step 2: Setting up connection pool');
  console.log('─'.repeat(60));

  const pool = await session.time('setup-pool', async () => {
    const p = new McpConnectionPool({
      factory: async (options: ConnectionOptions): Promise<McpConnection> => {
        const client = new SimulatedMcpClient(options.url);
        await client.connect();
        return wrapMcpClient(client);
      },
      minConnections: 2,
      maxConnections: 5,
      idleTimeoutMs: 30000,
      validateOnAcquire: false,
    });

    // Warm up the pool
    await p.warmup([SERVER_URL]);
    return p;
  });

  console.log(`  Pool ready: ${pool.getStats().idleConnections} connections\n`);

  // ─────────────────────────────────────────────────────────────
  // Step 3: Set up tool definition cacher
  // ─────────────────────────────────────────────────────────────

  console.log('Step 3: Setting up tool definition cacher');
  console.log('─'.repeat(60));

  const cacher = new ToolDefinitionCacher({
    fetchTools: async () => {
      return pool.withConnection({ url: SERVER_URL }, (conn) => conn.listTools());
    },
    ttlMs: 60000, // Cache for 1 minute
    autoRefresh: true,
  });

  // Preload the cache
  await session.time('preload-cache', async () => {
    await cacher.preload();
  });

  const tools = await cacher.getTools();
  console.log(`  Cached ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);

  // ─────────────────────────────────────────────────────────────
  // Step 4: Set up call batcher
  // ─────────────────────────────────────────────────────────────

  console.log('Step 4: Setting up call batcher');
  console.log('─'.repeat(60));

  const batcher = new McpCallBatcher({
    executor: createParallelExecutor(async (name, args) => {
      return pool.withConnection({ url: SERVER_URL }, (conn) =>
        conn.callTool(name, args)
      );
    }),
    maxBatchSize: 10,
    maxWaitMs: 20,
  });

  console.log('  Batcher ready\n');

  // ─────────────────────────────────────────────────────────────
  // Step 5: Simulate a workflow
  // ─────────────────────────────────────────────────────────────

  console.log('Step 5: Running simulated workflow');
  console.log('─'.repeat(60));

  await session.time('workflow', async () => {
    // First, get tool definitions (from cache)
    const availableTools = await session.time('get-tool-definitions', async () => {
      return cacher.getTools();
    });

    console.log(`  Available tools: ${availableTools.length}`);

    // Make multiple tool calls (will be batched)
    const results = await session.time('batch-tool-calls', async () => {
      const calls = [
        batcher.call('read_file', { path: '/src/index.ts' }),
        batcher.call('read_file', { path: '/package.json' }),
        batcher.call('search', { query: 'TODO' }),
        batcher.call('analyze', { file: '/src/main.ts' }),
        batcher.call('read_file', { path: '/README.md' }),
      ];

      return Promise.all(calls);
    });

    console.log(`  Completed ${results.length} tool calls`);

    // Make some more calls
    await session.time('additional-calls', async () => {
      await Promise.all([
        batcher.call('write_file', { path: '/out.txt', content: 'data' }),
        batcher.call('search', { query: 'FIXME' }),
      ]);
    });
  });

  console.log('');

  // ─────────────────────────────────────────────────────────────
  // Step 6: Show statistics
  // ─────────────────────────────────────────────────────────────

  console.log('Step 6: Statistics');
  console.log('─'.repeat(60));

  const batcherStats = batcher.getStats();
  const cacherStats = cacher.getStats();
  const poolStats = pool.getStats();

  console.log('Batcher Stats:');
  console.log(`  Total calls: ${batcherStats.totalCalls}`);
  console.log(`  Total batches: ${batcherStats.totalBatches}`);
  console.log(`  Avg batch size: ${batcherStats.averageBatchSize.toFixed(1)}`);
  console.log(`  Round-trips saved: ${batcherStats.callsSaved}`);
  console.log('');

  console.log('Cacher Stats:');
  console.log(`  Cache hits: ${cacherStats.hits}`);
  console.log(`  Cache misses: ${cacherStats.misses}`);
  console.log(`  Hit rate: ${(cacherStats.hitRate * 100).toFixed(0)}%`);
  console.log('');

  console.log('Pool Stats:');
  console.log(`  Connections created: ${poolStats.totalCreated}`);
  console.log(`  Connections reused: ${poolStats.totalReused}`);
  console.log(`  Currently idle: ${poolStats.idleConnections}`);
  console.log('');

  // ─────────────────────────────────────────────────────────────
  // Step 7: Show profiler report
  // ─────────────────────────────────────────────────────────────

  console.log('Step 7: Profiler Report');
  console.log('─'.repeat(60));

  const report = session.end();
  profiler.printReport(report);

  // ─────────────────────────────────────────────────────────────
  // Step 8: Cleanup
  // ─────────────────────────────────────────────────────────────

  console.log('Step 8: Cleanup');
  console.log('─'.repeat(60));

  cacher.dispose();
  await pool.shutdown();

  console.log('  All resources cleaned up\n');

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                         Summary                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('The MCP Performance Toolkit provides:');
  console.log('');
  console.log('1. Connection Pooling');
  console.log('   - Eliminates connection overhead for repeated requests');
  console.log('   - Supports multiple server URLs with per-URL limits');
  console.log('   - Automatic health checking and idle cleanup');
  console.log('');
  console.log('2. Tool Definition Caching');
  console.log('   - Avoids repeated fetches of tool/resource/prompt schemas');
  console.log('   - Configurable TTL with auto-refresh');
  console.log('   - Supports stale-while-revalidate pattern');
  console.log('');
  console.log('3. Call Batching');
  console.log('   - Combines multiple calls into single batch operations');
  console.log('   - Reduces round-trip overhead significantly');
  console.log('   - Priority queue for urgent calls');
  console.log('');
  console.log('4. Profiling');
  console.log('   - Measures where time goes in your workflows');
  console.log('   - Hierarchical timing with nested operations');
  console.log('   - Multiple output formats (console, JSON, waterfall)');
  console.log('');
}

main().catch(console.error);
