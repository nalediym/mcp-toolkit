# MCP Performance Toolkit

Performance utilities for Model Context Protocol applications. Transport-agnostic - works with any MCP client.

## The Problem

MCP applications often suffer from:
- **Too many round-trips** - Each tool call is a separate request
- **Repeated fetches** - `listTools()` called over and over
- **Connection overhead** - New connection for every operation
- **No visibility** - "Why is this slow?" with no way to find out

## The Solution

Four utilities that solve these problems:

| Utility | Problem | Solution |
|---------|---------|----------|
| **Batcher** | 10 calls = 10 round-trips | Group calls, send together |
| **Cacher** | `listTools()` called 50 times | Cache it, fetch once |
| **Pooler** | Connect → use → disconnect | Reuse connections |
| **Profiler** | "Where's it slow?" | Measure everything |

## Installation

```bash
npm install @mcp-toolkit/core
# or
pnpm add @mcp-toolkit/core
```

## Quick Start

```typescript
import {
  McpCallBatcher,
  ToolDefinitionCacher,
  McpConnectionPool,
  McpProfiler
} from '@mcp-toolkit/core';
```

---

## 1. Batcher - Reduce Round-Trips

**Problem:** Making 10 tool calls = 10 network round-trips.

**Solution:** Batch them together.

```typescript
import { McpCallBatcher, createParallelExecutor } from '@mcp-toolkit/core';

// Create a batcher
const batcher = new McpCallBatcher({
  executor: createParallelExecutor((name, args) =>
    mcpClient.callTool(name, args)
  ),
  maxBatchSize: 10,  // Max calls per batch
  maxWaitMs: 50,     // Wait up to 50ms for more calls
});

// These 5 calls become 1 batch
const results = await Promise.all([
  batcher.call('read_file', { path: '/a.txt' }),
  batcher.call('read_file', { path: '/b.txt' }),
  batcher.call('read_file', { path: '/c.txt' }),
  batcher.call('search', { query: 'TODO' }),
  batcher.call('analyze', { file: '/main.ts' }),
]);

// Check how much you saved
const stats = batcher.getStats();
console.log(`Saved ${stats.callsSaved} round-trips`);
// Saved 4 round-trips
```

### When to Use

- Multiple tool calls happening close together
- LLM workflows that make many small calls
- Any scenario with high call frequency

### Quick Setup (One-liner)

```typescript
import { withBatching } from '@mcp-toolkit/core';

const batchedCall = withBatching(mcpClient.callTool.bind(mcpClient), {
  maxBatchSize: 5,
  maxWaitMs: 100,
});

// Use it like normal - batching happens automatically
await batchedCall('tool1', { arg: 1 });
```

---

## 2. Cacher - Stop Repeating Yourself

**Problem:** Calling `listTools()` every time you need the tool list.

**Solution:** Cache it.

```typescript
import { ToolDefinitionCacher } from '@mcp-toolkit/core';

const cacher = new ToolDefinitionCacher({
  fetchTools: () => mcpClient.listTools(),
  fetchResources: () => mcpClient.listResources(),
  fetchPrompts: () => mcpClient.listPrompts(),
  ttlMs: 60000,  // Cache for 1 minute
});

// First call: fetches from server
const tools1 = await cacher.getTools();

// Next 100 calls: instant (from cache)
const tools2 = await cacher.getTools();
const tools3 = await cacher.getTools();
// ...

// Check cache performance
const stats = cacher.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(0)}%`);
// Hit rate: 99%
```

### Stale-While-Revalidate

Return stale data immediately while refreshing in the background:

```typescript
const tools = await cacher.getTools({ staleWhileRevalidate: true });
// Returns cached data instantly, refreshes in background
```

### Force Refresh

```typescript
const freshTools = await cacher.getTools({ forceRefresh: true });
```

### Quick Setup (One-liner)

```typescript
import { withCaching } from '@mcp-toolkit/core';

const cachedListTools = withCaching(
  () => mcpClient.listTools(),
  { ttlMs: 60000 }
);

const tools = await cachedListTools();
```

---

## 3. Pooler - Reuse Connections

**Problem:** Creating a new connection for every request.

**Solution:** Pool and reuse them.

```typescript
import { McpConnectionPool, wrapMcpClient } from '@mcp-toolkit/core';

const pool = new McpConnectionPool({
  factory: async (options) => {
    const client = new McpClient();
    await client.connect(options.url);
    return wrapMcpClient(client);
  },
  minConnections: 2,   // Keep 2 ready
  maxConnections: 10,  // Never exceed 10
  idleTimeoutMs: 60000, // Close after 1 min idle
});

// Pre-warm the pool (optional)
await pool.warmup(['http://localhost:50051']);

// Use connections
const result = await pool.withConnection(
  { url: 'http://localhost:50051' },
  async (conn) => {
    return conn.callTool('my-tool', { arg: 'value' });
  }
);
// Connection automatically returned to pool

// Check pool stats
const stats = pool.getStats();
console.log(`Reused: ${stats.totalReused}, Created: ${stats.totalCreated}`);
// Reused: 47, Created: 3
```

### Manual Acquire/Release

```typescript
const conn = await pool.acquire({ url: 'http://localhost:50051' });
try {
  await conn.callTool('tool1', {});
  await conn.callTool('tool2', {});
} finally {
  pool.release(conn);
}
```

### Load Balancing

```typescript
import { createLoadBalancer } from '@mcp-toolkit/core';

const balancer = createLoadBalancer([
  'http://server1:50051',
  'http://server2:50051',
  'http://server3:50051',
]);

// Round-robin through servers
const url = balancer.next(); // server1
const url2 = balancer.next(); // server2
const url3 = balancer.next(); // server3
const url4 = balancer.next(); // server1 (wraps around)
```

---

## 4. Profiler - Find the Bottleneck

**Problem:** "Why is my MCP app slow?"

**Solution:** Measure everything.

```typescript
import { McpProfiler } from '@mcp-toolkit/core';

const profiler = new McpProfiler();
const session = profiler.startSession('my-workflow');

// Time operations
await session.time('fetch-tools', async () => {
  return await mcpClient.listTools();
});

await session.time('process-files', async () => {
  // Nested timing
  await session.time('read-file', () => readFile('/a.txt'));
  await session.time('parse-file', () => parseContent(content));
  await session.time('analyze', () => analyze(parsed));
});

// Get the report
const report = session.end();
profiler.printReport(report);
```

**Output:**
```
========================================
Profiler Report - Total: 234.56ms
========================================

Timeline:
---------
fetch-tools: 45.23ms
process-files: 189.33ms
  read-file: 12.45ms
  parse-file: 34.67ms
  analyze: 142.21ms

Summary by Operation:
--------------------
analyze:
  Count: 1
  Total: 142.21ms
  Avg: 142.21ms
```

### Quick Timing

```typescript
// One-off timing without a session
const { result, duration } = await profiler.timeOnce(
  'quick-op',
  () => doSomething()
);
console.log(`Took ${duration}ms`);
```

### Profile an Entire Client

```typescript
import { profileMcpClient } from '@mcp-toolkit/core';

const session = profiler.startSession('client-ops');
const profiledClient = profileMcpClient(mcpClient, session);

// All method calls are now automatically profiled
await profiledClient.listTools();
await profiledClient.callTool('tool1', {});
await profiledClient.callTool('tool2', {});

const report = session.end();
profiler.printReport(report);
```

### Waterfall Visualization

```typescript
const waterfall = profiler.generateWaterfall(report);
console.log(waterfall);
```

```
fetch-tools (45.2ms)
|||||||
process-files (189.3ms)
       read-file (12.5ms)
       ||
       parse-file (34.7ms)
       |||||
       analyze (142.2ms)
       ||||||||||||||||||||||||
```

---

## Combining Everything

Here's a complete setup using all four utilities:

```typescript
import {
  McpCallBatcher,
  createParallelExecutor,
  ToolDefinitionCacher,
  McpConnectionPool,
  wrapMcpClient,
  McpProfiler,
} from '@mcp-toolkit/core';

// 1. Profiler - measure everything
const profiler = new McpProfiler();
const session = profiler.startSession('workflow');

// 2. Pool - reuse connections
const pool = new McpConnectionPool({
  factory: async (opts) => {
    const client = new McpClient();
    await client.connect(opts.url);
    return wrapMcpClient(client);
  },
  maxConnections: 10,
});

const SERVER = 'http://localhost:50051';

// 3. Cacher - don't repeat fetches
const cacher = new ToolDefinitionCacher({
  fetchTools: () => pool.withConnection({ url: SERVER }, c => c.listTools()),
  ttlMs: 60000,
});

// 4. Batcher - reduce round-trips
const batcher = new McpCallBatcher({
  executor: createParallelExecutor((name, args) =>
    pool.withConnection({ url: SERVER }, c => c.callTool(name, args))
  ),
  maxBatchSize: 10,
});

// Use it
await session.time('get-tools', () => cacher.getTools());

await session.time('batch-calls', () => Promise.all([
  batcher.call('tool1', {}),
  batcher.call('tool2', {}),
  batcher.call('tool3', {}),
]));

// See results
const report = session.end();
profiler.printReport(report);

console.log('Batcher:', batcher.getStats());
console.log('Cacher:', cacher.getStats());
console.log('Pool:', pool.getStats());

// Cleanup
cacher.dispose();
await pool.shutdown();
```

---

## Run the Demo

```bash
cd examples/toolkit-demo
pnpm install
pnpm start
```

---

## API Reference

### Batcher

```typescript
new McpCallBatcher(options: {
  executor: (calls: Array<{name, args}>) => Promise<ToolCallResult[]>;
  maxBatchSize?: number;   // Default: 10
  maxWaitMs?: number;      // Default: 50
  executeOnFull?: boolean; // Default: true
})

batcher.call(name, args, priority?) → Promise<ToolCallResult>
batcher.callImmediate(name, args) → Promise<ToolCallResult>
batcher.flush() → Promise<void>
batcher.getStats() → BatcherStats
batcher.cancelAll(reason?) → void
```

### Cacher

```typescript
new ToolDefinitionCacher(options: {
  fetchTools?: () => Promise<ToolDefinition[]>;
  fetchResources?: () => Promise<ResourceDefinition[]>;
  fetchPrompts?: () => Promise<PromptDefinition[]>;
  ttlMs?: number;        // Default: 300000 (5 min)
  autoRefresh?: boolean; // Default: false
})

cacher.getTools(options?) → Promise<ToolDefinition[]>
cacher.getResources(options?) → Promise<ResourceDefinition[]>
cacher.getPrompts(options?) → Promise<PromptDefinition[]>
cacher.invalidate(type) → void
cacher.invalidateAll() → void
cacher.getStats() → CacheStats
cacher.dispose() → void
```

### Pooler

```typescript
new McpConnectionPool(options: {
  factory: (options: ConnectionOptions) => Promise<McpConnection>;
  minConnections?: number;      // Default: 0
  maxConnections?: number;      // Default: 10
  maxTotalConnections?: number; // Default: 50
  idleTimeoutMs?: number;       // Default: 60000
  acquireTimeoutMs?: number;    // Default: 30000
  validateOnAcquire?: boolean;  // Default: true
})

pool.acquire(options) → Promise<McpConnection>
pool.release(connection) → void
pool.withConnection(options, fn) → Promise<T>
pool.warmup(urls) → Promise<void>
pool.shutdown() → Promise<void>
pool.getStats() → PoolStats
```

### Profiler

```typescript
new McpProfiler(options?: { maxCompletedReports?: number })

profiler.startSession(name) → ProfilingSession
profiler.endSession(name) → ProfilerReport
profiler.timeOnce(op, fn) → Promise<{result, duration}>
profiler.printReport(report, options?) → void
profiler.generateWaterfall(report) → string

// Session methods
session.time(operation, fn, metadata?) → T | Promise<T>
session.start(operation, metadata?) → () => void
session.record(operation, durationMs, metadata?) → void
session.mark(name, metadata?) → void
session.end() → ProfilerReport
```

---

## License

MIT
