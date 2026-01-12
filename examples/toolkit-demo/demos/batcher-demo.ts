/**
 * MCP Call Batcher Demo
 *
 * This demo shows how the batcher combines multiple tool calls into batches,
 * reducing overhead when making many calls in quick succession.
 */

import {
  McpCallBatcher,
  createParallelExecutor,
  withBatching,
  type ToolCallResult,
} from '@mcp-toolkit/core';

// Simulated MCP client that adds latency per call
async function simulatedCallTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  // Simulate network latency (50ms per call)
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    content: [{ type: 'text', text: `Result from ${name}: ${JSON.stringify(args)}` }],
    isError: false,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('MCP Call Batcher Demo');
  console.log('='.repeat(60));
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 1: Without batching (baseline)
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 1: Without batching (10 sequential calls)');
  console.log('-'.repeat(40));

  const startWithout = performance.now();

  for (let i = 0; i < 10; i++) {
    await simulatedCallTool(`tool-${i}`, { index: i });
  }

  const durationWithout = performance.now() - startWithout;
  console.log(`Total time: ${durationWithout.toFixed(0)}ms`);
  console.log(`Expected: ~500ms (10 calls x 50ms each)`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 2: With batching (parallel execution)
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 2: With batching (10 calls in parallel)');
  console.log('-'.repeat(40));

  const batcher = new McpCallBatcher({
    executor: createParallelExecutor(simulatedCallTool),
    maxBatchSize: 10,
    maxWaitMs: 10, // Short wait to collect calls
    onBatch: (size, duration) => {
      console.log(`  Batch executed: ${size} calls in ${duration.toFixed(0)}ms`);
    },
  });

  const startWith = performance.now();

  // Make 10 calls that will be batched together
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(batcher.call(`tool-${i}`, { index: i }));
  }

  await Promise.all(promises);
  const durationWith = performance.now() - startWith;

  console.log(`Total time: ${durationWith.toFixed(0)}ms`);
  console.log(`Expected: ~60ms (1 batch with parallel calls + 10ms wait)`);
  console.log(`Speedup: ${(durationWithout / durationWith).toFixed(1)}x`);
  console.log();

  // Print statistics
  const stats = batcher.getStats();
  console.log('Batcher Statistics:');
  console.log(`  Total calls: ${stats.totalCalls}`);
  console.log(`  Total batches: ${stats.totalBatches}`);
  console.log(`  Average batch size: ${stats.averageBatchSize.toFixed(1)}`);
  console.log(`  Round-trips saved: ${stats.callsSaved}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 3: Priority-based batching
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 3: Priority-based batching');
  console.log('-'.repeat(40));

  const priorityBatcher = new McpCallBatcher({
    executor: async (calls) => {
      console.log('  Executing batch:', calls.map((c) => c.name).join(', '));
      return Promise.all(calls.map((c) => simulatedCallTool(c.name, c.args)));
    },
    maxBatchSize: 3,
    maxWaitMs: 100,
  });

  // Queue calls with different priorities
  const priorityPromises = [
    priorityBatcher.call('low-priority-1', {}, 0),
    priorityBatcher.call('high-priority-1', {}, 10),
    priorityBatcher.call('low-priority-2', {}, 0),
    priorityBatcher.call('high-priority-2', {}, 10),
    priorityBatcher.call('urgent', {}, 100),
    priorityBatcher.call('normal', {}, 5),
  ];

  await Promise.all(priorityPromises);
  console.log('  (High priority calls are executed first in each batch)');
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 4: Using the withBatching wrapper
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 4: Using withBatching() wrapper');
  console.log('-'.repeat(40));

  const batchedCall = withBatching(simulatedCallTool, {
    maxBatchSize: 5,
    maxWaitMs: 20,
  });

  // Access the underlying batcher for stats
  const underlyingBatcher = (batchedCall as any).batcher as McpCallBatcher;
  underlyingBatcher.resetStats();

  const wrapperStart = performance.now();
  await Promise.all([
    batchedCall('wrapped-tool-1', { x: 1 }),
    batchedCall('wrapped-tool-2', { x: 2 }),
    batchedCall('wrapped-tool-3', { x: 3 }),
  ]);
  const wrapperDuration = performance.now() - wrapperStart;

  console.log(`3 calls completed in ${wrapperDuration.toFixed(0)}ms`);
  console.log(`Stats: ${JSON.stringify(underlyingBatcher.getStats())}`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 5: Concurrency-limited execution
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 5: Concurrency-limited execution');
  console.log('-'.repeat(40));

  const limitedBatcher = new McpCallBatcher({
    executor: createParallelExecutor(simulatedCallTool, 2), // Only 2 concurrent
    maxBatchSize: 10,
    maxWaitMs: 10,
  });

  const limitedStart = performance.now();
  const limitedPromises = [];
  for (let i = 0; i < 10; i++) {
    limitedPromises.push(limitedBatcher.call(`limited-tool-${i}`, {}));
  }
  await Promise.all(limitedPromises);
  const limitedDuration = performance.now() - limitedStart;

  console.log(`10 calls with concurrency=2: ${limitedDuration.toFixed(0)}ms`);
  console.log('Expected: ~260ms (5 batches of 2 calls at 50ms each + wait time)');
  console.log();

  console.log('='.repeat(60));
  console.log('Demo complete!');
}

main().catch(console.error);
