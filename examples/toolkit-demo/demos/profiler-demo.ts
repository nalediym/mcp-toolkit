/**
 * MCP Profiler Demo
 *
 * This demo shows how to use the profiler to measure where time goes
 * in MCP workflows.
 */

import {
  McpProfiler,
  ProfilingSession,
  profileMcpClient,
  createProfilingMiddleware,
  createMeasure,
  type ToolCallResult,
  type ToolDefinition,
} from 'mcp-performance';

// Simulated MCP operations
async function simulatedListTools(): Promise<ToolDefinition[]> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return [
    { name: 'read_file', inputSchema: {} },
    { name: 'write_file', inputSchema: {} },
  ];
}

async function simulatedCallTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 40));
  return { content: [{ type: 'text', text: 'result' }], isError: false };
}

// Simulated client for proxy demo
const simulatedClient = {
  listTools: simulatedListTools,
  callTool: simulatedCallTool,
  ping: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  },
};

async function main() {
  console.log('='.repeat(60));
  console.log('MCP Profiler Demo');
  console.log('='.repeat(60));
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 1: Basic profiling session
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 1: Basic profiling session');
  console.log('-'.repeat(40));

  const profiler = new McpProfiler();
  const session = profiler.startSession('basic-workflow');

  // Time various operations
  await session.time('list-tools', async () => {
    return simulatedListTools();
  });

  await session.time('call-tool-1', async () => {
    return simulatedCallTool('read_file', { path: '/test' });
  });

  await session.time('call-tool-2', async () => {
    return simulatedCallTool('write_file', { path: '/out', content: 'data' });
  });

  const report = session.end();
  profiler.printReport(report);

  // ─────────────────────────────────────────────────────────────
  // Demo 2: Nested timing (hierarchical)
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 2: Nested timing (hierarchical)');
  console.log('-'.repeat(40));

  const nestedSession = profiler.startSession('nested-workflow');

  await nestedSession.time('full-operation', async () => {
    // Nested timing
    const tools = await nestedSession.time('fetch-tools', async () => {
      return simulatedListTools();
    });

    await nestedSession.time('process-tools', async () => {
      for (const tool of tools) {
        await nestedSession.time(`call-${tool.name}`, async () => {
          return simulatedCallTool(tool.name, {});
        });
      }
    });
  });

  const nestedReport = nestedSession.end();
  profiler.printReport(nestedReport);

  // ─────────────────────────────────────────────────────────────
  // Demo 3: Manual start/end timing
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 3: Manual start/end timing');
  console.log('-'.repeat(40));

  const manualSession = profiler.startSession('manual-timing');

  const endListTools = manualSession.start('list-tools');
  await simulatedListTools();
  endListTools();

  const endCallTool = manualSession.start('call-tool');
  await simulatedCallTool('test', {});
  endCallTool();

  // Record a known duration
  manualSession.record('external-operation', 75);

  // Add markers
  manualSession.mark('checkpoint-1');
  await new Promise((resolve) => setTimeout(resolve, 20));
  manualSession.mark('checkpoint-2');

  const manualReport = manualSession.end();
  profiler.printReport(manualReport, { showWaterfall: true, showSummary: false });

  // ─────────────────────────────────────────────────────────────
  // Demo 4: Profiling a client with proxy
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 4: Profiling a client with proxy');
  console.log('-'.repeat(40));

  const clientSession = profiler.startSession('client-proxy');
  const profiledClient = profileMcpClient(simulatedClient, clientSession);

  // All calls are automatically profiled
  await profiledClient.listTools();
  await profiledClient.callTool('test1', { x: 1 });
  await profiledClient.callTool('test2', { x: 2 });
  await profiledClient.ping();

  const clientReport = clientSession.end();
  profiler.printReport(clientReport);

  // ─────────────────────────────────────────────────────────────
  // Demo 5: Middleware-style profiling
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 5: Middleware-style profiling');
  console.log('-'.repeat(40));

  const middleware = createProfilingMiddleware();

  // Wrap calls with middleware
  async function profiledCallTool(name: string, args: Record<string, unknown>) {
    const ctx = middleware.before('callTool', { name, args });
    try {
      const result = await simulatedCallTool(name, args);
      middleware.after(ctx, result);
      return result;
    } catch (error) {
      middleware.error(ctx, error);
      throw error;
    }
  }

  // Make several calls
  for (let i = 0; i < 5; i++) {
    await profiledCallTool(`tool-${i}`, { iteration: i });
  }

  const middlewareStats = middleware.getStats();
  console.log('Middleware Statistics:');
  for (const [op, stats] of Object.entries(middlewareStats)) {
    console.log(`  ${op}:`);
    console.log(`    Count: ${stats.count}`);
    console.log(`    Total: ${stats.totalTime.toFixed(2)}ms`);
    console.log(`    Avg: ${stats.avgTime.toFixed(2)}ms`);
    console.log(`    Errors: ${stats.errors}`);
  }
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 6: Simple measurement helper
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 6: Simple measurement helper');
  console.log('-'.repeat(40));

  const measure = createMeasure();

  measure.start('operation-1');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const duration1 = measure.end('operation-1');
  console.log(`operation-1: ${duration1.toFixed(2)}ms`);

  measure.start('operation-2');
  await new Promise((resolve) => setTimeout(resolve, 30));
  const duration2 = measure.end('operation-2');
  console.log(`operation-2: ${duration2.toFixed(2)}ms`);

  console.log('\nAll measurements:', measure.getResults());
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 7: Waterfall visualization
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 7: Waterfall visualization');
  console.log('-'.repeat(40));

  const waterfallSession = profiler.startSession('waterfall-demo');

  await waterfallSession.time('init', () =>
    new Promise((r) => setTimeout(r, 20))
  );
  await waterfallSession.time('fetch-data', () =>
    new Promise((r) => setTimeout(r, 50))
  );
  await waterfallSession.time('process', async () => {
    await waterfallSession.time('parse', () =>
      new Promise((r) => setTimeout(r, 15))
    );
    await waterfallSession.time('transform', () =>
      new Promise((r) => setTimeout(r, 25))
    );
  });
  await waterfallSession.time('render', () =>
    new Promise((r) => setTimeout(r, 30))
  );

  const waterfallReport = waterfallSession.end();
  console.log('ASCII Waterfall:');
  console.log(profiler.generateWaterfall(waterfallReport, 50));
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 8: JSON export
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 8: JSON export');
  console.log('-'.repeat(40));

  const jsonSession = profiler.startSession('json-export');
  await jsonSession.time('op1', () => new Promise((r) => setTimeout(r, 10)));
  await jsonSession.time('op2', () => new Promise((r) => setTimeout(r, 20)));
  const jsonReport = jsonSession.end();

  const json = profiler.formatAsJson(jsonReport, true);
  console.log('JSON Report (truncated):');
  console.log(json.slice(0, 500) + '...');
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 9: Quick one-off timing
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 9: Quick one-off timing');
  console.log('-'.repeat(40));

  const { result, duration } = await profiler.timeOnce('quick-operation', async () => {
    await new Promise((r) => setTimeout(r, 42));
    return 'done';
  });

  console.log(`Result: ${result}`);
  console.log(`Duration: ${duration.toFixed(2)}ms`);
  console.log();

  // ─────────────────────────────────────────────────────────────
  // Demo 10: Completed reports history
  // ─────────────────────────────────────────────────────────────
  console.log('Demo 10: Completed reports history');
  console.log('-'.repeat(40));

  const completedReports = profiler.getCompletedReports();
  console.log(`Total completed sessions: ${completedReports.length}`);
  console.log('Session durations:');
  for (const r of completedReports) {
    console.log(`  - ${r.totalDuration.toFixed(2)}ms`);
  }
  console.log();

  console.log('='.repeat(60));
  console.log('Demo complete!');
}

main().catch(console.error);
