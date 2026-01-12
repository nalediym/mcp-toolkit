/**
 * Tool Definition Cacher Demo
 *
 * This demo shows how the cacher reduces repeated fetches of tool definitions.
 */

import {
  ToolDefinitionCacher,
  MemoryStorageAdapter,
  withCaching,
  type ToolDefinition,
  type ResourceDefinition,
} from 'mcp-performance';

// Simulated slow fetch functions
let fetchCallCount = 0;

async function simulatedFetchTools(): Promise<ToolDefinition[]> {
  fetchCallCount++;
  console.log(`    [Network] Fetching tools... (call #${fetchCallCount})`);

  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 100));

  return [
    {
      name: 'read_file',
      description: 'Read contents of a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
    {
      name: 'write_file',
      description: 'Write contents to a file',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
    {
      name: 'search',
      description: 'Search for files',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ];
}

async function simulatedFetchResources(): Promise<ResourceDefinition[]> {
  await new Promise((resolve) => setTimeout(resolve, 80));

  return [
    { uri: 'file:///workspace', name: 'Workspace', description: 'Current workspace' },
    { uri: 'file:///config', name: 'Config', description: 'Configuration files' },
  ];
}

async function main() {
  console.log('='.repeat(60));
  console.log('Tool Definition Cacher Demo');
  console.log('='.repeat(60));
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 1: Basic caching
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 1: Basic caching');
  console.log('-'.repeat(40));

  fetchCallCount = 0;

  const cacher = new ToolDefinitionCacher({
    fetchTools: simulatedFetchTools,
    fetchResources: simulatedFetchResources,
    ttlMs: 5000, // 5 second TTL for demo
  });

  console.log('First call (cache miss):');
  let start = performance.now();
  const tools1 = await cacher.getTools();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);
  console.log(`  Tools: ${tools1.map((t) => t.name).join(', ')}`);
  console.log();

  console.log('Second call (cache hit):');
  start = performance.now();
  const tools2 = await cacher.getTools();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);
  console.log(`  Tools: ${tools2.map((t) => t.name).join(', ')}`);
  console.log();

  console.log('Third call (cache hit):');
  start = performance.now();
  const tools3 = await cacher.getTools();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);
  console.log();

  const stats = cacher.getStats();
  console.log('Cache Statistics:');
  console.log(`  Hits: ${stats.hits}`);
  console.log(`  Misses: ${stats.misses}`);
  console.log(`  Hit Rate: ${(stats.hitRate * 100).toFixed(0)}%`);
  console.log(`  Network calls made: ${fetchCallCount}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 2: Looking up specific tools
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 2: Looking up specific tools');
  console.log('-'.repeat(40));

  const readFileTool = await cacher.getTool('read_file');
  console.log('read_file tool:');
  console.log(`  Description: ${readFileTool?.description}`);
  console.log(`  Schema: ${JSON.stringify(readFileTool?.inputSchema)}`);
  console.log();

  const nonExistent = await cacher.getTool('nonexistent_tool');
  console.log(`nonexistent_tool: ${nonExistent ?? 'undefined'}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 3: Force refresh
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 3: Force refresh');
  console.log('-'.repeat(40));

  console.log('Forcing a refresh despite valid cache:');
  start = performance.now();
  await cacher.getTools({ forceRefresh: true });
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);
  console.log(`  Network calls now: ${fetchCallCount}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 4: Stale-while-revalidate
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 4: Stale-while-revalidate pattern');
  console.log('-'.repeat(40));

  // Create a cacher with very short TTL
  const swrCacher = new ToolDefinitionCacher({
    fetchTools: simulatedFetchTools,
    ttlMs: 100, // 100ms TTL
  });

  // First fetch populates cache
  await swrCacher.getTools();

  // Wait for cache to expire
  await new Promise((resolve) => setTimeout(resolve, 150));

  console.log('Cache is now stale. Using stale-while-revalidate:');
  start = performance.now();
  const swrTools = await swrCacher.getTools({ staleWhileRevalidate: true });
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms (returns stale immediately)`);
  console.log(`  Got ${swrTools.length} tools`);

  // Wait a bit for background refresh
  await new Promise((resolve) => setTimeout(resolve, 150));
  console.log('  (Background refresh completed)');
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 5: Using withCaching wrapper
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 5: Using withCaching() wrapper');
  console.log('-'.repeat(40));

  const cachedFetch = withCaching(simulatedFetchTools, { ttlMs: 2000 });

  console.log('First call:');
  start = performance.now();
  await cachedFetch();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);

  console.log('Second call:');
  start = performance.now();
  await cachedFetch();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);

  console.log('Third call:');
  start = performance.now();
  await cachedFetch();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 6: Invalidation
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 6: Cache invalidation');
  console.log('-'.repeat(40));

  console.log(`Cache valid before invalidation: ${cacher.isValid('tools')}`);
  cacher.invalidate('tools');
  console.log(`Cache valid after invalidation: ${cacher.isValid('tools')}`);

  console.log('Next fetch will go to network:');
  start = performance.now();
  await cacher.getTools();
  console.log(`  Time: ${(performance.now() - start).toFixed(0)}ms`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 7: Preloading
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 7: Preloading caches');
  console.log('-'.repeat(40));

  const preloadCacher = new ToolDefinitionCacher({
    fetchTools: simulatedFetchTools,
    fetchResources: simulatedFetchResources,
    ttlMs: 5000,
  });

  console.log('Preloading all caches...');
  start = performance.now();
  await preloadCacher.preload();
  console.log(`  Preload time: ${(performance.now() - start).toFixed(0)}ms`);

  console.log('Subsequent calls are instant:');
  start = performance.now();
  await preloadCacher.getTools();
  await preloadCacher.getResources();
  console.log(`  Both fetches: ${(performance.now() - start).toFixed(0)}ms`);
  console.log();

  // Clean up
  cacher.dispose();
  swrCacher.dispose();
  preloadCacher.dispose();

  console.log('='.repeat(60));
  console.log('Demo complete!');
}

main().catch(console.error);
