/**
 * Connection Pooler Demo
 *
 * This demo shows how connection pooling reduces the overhead of
 * establishing new connections for each request.
 */

import {
  McpConnectionPool,
  wrapMcpClient,
  createLoadBalancer,
  type McpConnection,
  type ConnectionOptions,
  type ToolCallResult,
  type ToolDefinition,
} from 'mcp-performance';

// Simulated MCP client
class SimulatedMcpClient {
  private id: string;
  private connected = false;

  constructor(url: string) {
    this.id = `client-${Math.random().toString(36).slice(2, 6)}`;
    console.log(`    [${this.id}] Creating client for ${url}`);
  }

  async connect(): Promise<void> {
    // Simulate connection time (100ms)
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.connected = true;
    console.log(`    [${this.id}] Connected`);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (!this.connected) throw new Error('Not connected');
    // Simulate call time (20ms)
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      content: [{ type: 'text', text: `${this.id} executed ${name}` }],
      isError: false,
    };
  }

  async listTools(): Promise<ToolDefinition[]> {
    if (!this.connected) throw new Error('Not connected');
    await new Promise((resolve) => setTimeout(resolve, 10));
    return [{ name: 'test-tool', inputSchema: {} }];
  }

  async ping(): Promise<void> {
    if (!this.connected) throw new Error('Not connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log(`    [${this.id}] Disconnected`);
  }
}

// Connection factory
async function createConnection(options: ConnectionOptions): Promise<McpConnection> {
  const client = new SimulatedMcpClient(options.url);
  await client.connect();
  return wrapMcpClient(client);
}

async function main() {
  console.log('='.repeat(60));
  console.log('Connection Pooler Demo');
  console.log('='.repeat(60));
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 1: Without pooling (baseline)
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 1: Without pooling (5 sequential requests)');
  console.log('-'.repeat(40));

  const startWithout = performance.now();

  for (let i = 0; i < 5; i++) {
    const client = new SimulatedMcpClient('http://localhost:50051');
    await client.connect();
    await client.callTool(`tool-${i}`, {});
    await client.disconnect();
  }

  const durationWithout = performance.now() - startWithout;
  console.log(`  Total time: ${durationWithout.toFixed(0)}ms`);
  console.log('  (100ms connect + 20ms call + disconnect) x 5 = ~600ms');
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 2: With pooling
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 2: With pooling (5 sequential requests)');
  console.log('-'.repeat(40));

  const pool = new McpConnectionPool({
    factory: createConnection,
    minConnections: 0,
    maxConnections: 5,
    idleTimeoutMs: 10000,
    validateOnAcquire: false, // Skip validation for demo speed
  });

  const startWith = performance.now();

  for (let i = 0; i < 5; i++) {
    await pool.withConnection({ url: 'http://localhost:50051' }, async (conn) => {
      await conn.callTool(`tool-${i}`, {});
    });
  }

  const durationWith = performance.now() - startWith;
  console.log(`  Total time: ${durationWith.toFixed(0)}ms`);
  console.log('  First: 100ms connect + 20ms call, Rest: 20ms call each');
  console.log(`  Speedup: ${(durationWithout / durationWith).toFixed(1)}x`);
  console.log();

  let stats = pool.getStats();
  console.log('Pool Statistics:');
  console.log(`  Total created: ${stats.totalCreated}`);
  console.log(`  Total reused: ${stats.totalReused}`);
  console.log(`  Active: ${stats.activeConnections}`);
  console.log(`  Idle: ${stats.idleConnections}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 3: Concurrent requests
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 3: Concurrent requests');
  console.log('-'.repeat(40));

  // Create a fresh pool
  const concurrentPool = new McpConnectionPool({
    factory: createConnection,
    maxConnections: 3, // Only 3 connections max
    acquireTimeoutMs: 5000,
    validateOnAcquire: false,
  });

  console.log('Making 10 concurrent requests with max 3 connections:');
  const concurrentStart = performance.now();

  const concurrentPromises = [];
  for (let i = 0; i < 10; i++) {
    concurrentPromises.push(
      concurrentPool.withConnection({ url: 'http://localhost:50051' }, async (conn) => {
        await conn.callTool(`concurrent-tool-${i}`, {});
        return i;
      })
    );
  }

  await Promise.all(concurrentPromises);
  const concurrentDuration = performance.now() - concurrentStart;

  console.log(`  Total time: ${concurrentDuration.toFixed(0)}ms`);
  console.log('  (Requests queue when all connections are in use)');

  const concurrentStats = concurrentPool.getStats();
  console.log(`  Connections created: ${concurrentStats.totalCreated}`);
  console.log(`  Connection reuses: ${concurrentStats.totalReused}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 4: Multiple server URLs
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 4: Multiple server URLs');
  console.log('-'.repeat(40));

  const multiPool = new McpConnectionPool({
    factory: createConnection,
    maxConnections: 2, // Per URL
    validateOnAcquire: false,
  });

  console.log('Connecting to two different servers:');

  await Promise.all([
    multiPool.withConnection({ url: 'http://server1:50051' }, async (conn) => {
      await conn.callTool('tool', {});
    }),
    multiPool.withConnection({ url: 'http://server2:50051' }, async (conn) => {
      await conn.callTool('tool', {});
    }),
  ]);

  const detailedStats = multiPool.getDetailedStats();
  console.log('  Per-URL stats:');
  for (const [url, urlStats] of Object.entries(detailedStats.byUrl)) {
    console.log(`    ${url}: idle=${urlStats.idle}, active=${urlStats.active}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 5: Load balancing
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 5: Load balancing across servers');
  console.log('-'.repeat(40));

  const balancer = createLoadBalancer([
    'http://server1:50051',
    'http://server2:50051',
    'http://server3:50051',
  ]);

  const lbPool = new McpConnectionPool({
    factory: createConnection,
    maxConnections: 2,
    validateOnAcquire: false,
  });

  console.log('Round-robin load balancing:');
  for (let i = 0; i < 6; i++) {
    const url = balancer.next();
    console.log(`  Request ${i + 1} -> ${url}`);
    await lbPool.withConnection({ url }, async (conn) => {
      await conn.callTool('tool', {});
    });
  }
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 6: Warmup
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 6: Pool warmup');
  console.log('-'.repeat(40));

  const warmPool = new McpConnectionPool({
    factory: createConnection,
    minConnections: 2,
    maxConnections: 5,
    validateOnAcquire: false,
  });

  console.log('Warming up pool with 2 connections:');
  const warmStart = performance.now();
  await warmPool.warmup(['http://localhost:50051']);
  const warmDuration = performance.now() - warmStart;
  console.log(`  Warmup time: ${warmDuration.toFixed(0)}ms`);

  const warmStats = warmPool.getStats();
  console.log(`  Connections ready: ${warmStats.idleConnections}`);

  console.log('\nFirst request after warmup (no connection overhead):');
  const postWarmStart = performance.now();
  await warmPool.withConnection({ url: 'http://localhost:50051' }, async (conn) => {
    await conn.callTool('test', {});
  });
  console.log(`  Request time: ${(performance.now() - postWarmStart).toFixed(0)}ms`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────
  console.log('Shutting down pools...');
  await Promise.all([
    pool.shutdown(),
    concurrentPool.shutdown(),
    multiPool.shutdown(),
    lbPool.shutdown(),
    warmPool.shutdown(),
  ]);

  console.log();
  console.log('='.repeat(60));
  console.log('Demo complete!');
}

main().catch(console.error);
