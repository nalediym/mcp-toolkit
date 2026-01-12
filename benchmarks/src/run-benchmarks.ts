#!/usr/bin/env tsx
/**
 * Benchmark Runner
 * Compares JSON-RPC MCP vs gRPC MCP transport performance
 */

import Table from 'cli-table3';
import * as jsonRpcBench from './json-rpc-client-bench.js';
import * as grpcBench from './grpc-client-bench.js';
import { formatMs, formatComparison, type BenchmarkResult } from './utils.js';
import { writeFileSync } from 'node:fs';

const ITERATIONS = parseInt(process.env.ITERATIONS ?? '100', 10);
const LARGE_PAYLOAD_SIZE = parseInt(process.env.PAYLOAD_SIZE ?? '10000', 10);

interface BenchmarkSuite {
  name: string;
  runJsonRpc: (iterations: number) => Promise<BenchmarkResult>;
  runGrpc: (iterations: number) => Promise<BenchmarkResult>;
}

const suites: BenchmarkSuite[] = [
  {
    name: 'Echo (small payload)',
    runJsonRpc: (n) => jsonRpcBench.runEchoBenchmark(n),
    runGrpc: (n) => grpcBench.runEchoBenchmark(n),
  },
  {
    name: 'Compute (minimal processing)',
    runJsonRpc: (n) => jsonRpcBench.runComputeBenchmark(n),
    runGrpc: (n) => grpcBench.runComputeBenchmark(n),
  },
  {
    name: 'List Tools',
    runJsonRpc: (n) => jsonRpcBench.runListToolsBenchmark(n),
    runGrpc: (n) => grpcBench.runListToolsBenchmark(n),
  },
  {
    name: `Large Response (${LARGE_PAYLOAD_SIZE} bytes)`,
    runJsonRpc: (n) => jsonRpcBench.runLargeResponseBenchmark(n, LARGE_PAYLOAD_SIZE),
    runGrpc: (n) => grpcBench.runLargeResponseBenchmark(n, LARGE_PAYLOAD_SIZE),
  },
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           gRPC-MCP vs JSON-RPC MCP Benchmark Suite             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Configuration:`);
  console.log(`  Iterations per test: ${ITERATIONS}`);
  console.log(`  Large payload size:  ${LARGE_PAYLOAD_SIZE} bytes`);
  console.log('');

  const results: { jsonRpc: BenchmarkResult; grpc: BenchmarkResult }[] = [];

  // Setup JSON-RPC
  console.log('Starting JSON-RPC server...');
  try {
    await jsonRpcBench.setup();
    console.log('  ✓ JSON-RPC server ready');
  } catch (error) {
    console.error('  ✗ Failed to start JSON-RPC server:', error);
    process.exit(1);
  }

  // Setup gRPC
  console.log('Starting gRPC server...');
  try {
    await grpcBench.setup();
    console.log('  ✓ gRPC server ready');
  } catch (error) {
    console.error('  ✗ Failed to start gRPC server:', error);
    await jsonRpcBench.teardown();
    process.exit(1);
  }

  console.log('');
  console.log('Running benchmarks...');
  console.log('');

  // Run each suite
  for (const suite of suites) {
    console.log(`  ${suite.name}...`);

    try {
      const jsonRpcResult = await suite.runJsonRpc(ITERATIONS);
      const grpcResult = await suite.runGrpc(ITERATIONS);

      results.push({ jsonRpc: jsonRpcResult, grpc: grpcResult });

      console.log(`    JSON-RPC: ${formatMs(jsonRpcResult.avgTimeMs)} avg`);
      console.log(`    gRPC:     ${formatMs(grpcResult.avgTimeMs)} avg`);
      console.log(`    → gRPC is ${formatComparison(grpcResult.avgTimeMs, jsonRpcResult.avgTimeMs)}`);
      console.log('');
    } catch (error) {
      console.error(`    ✗ Error: ${error}`);
      console.log('');
    }
  }

  // Cleanup
  console.log('Stopping servers...');
  await jsonRpcBench.teardown();
  await grpcBench.teardown();
  console.log('  ✓ Servers stopped');
  console.log('');

  // Print results table
  printResultsTable(results);

  // Save results to JSON
  const outputPath = `results/benchmark-${Date.now()}.json`;
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        config: {
          iterations: ITERATIONS,
          largePayloadSize: LARGE_PAYLOAD_SIZE,
        },
        results: results.map((r) => ({
          name: r.jsonRpc.name,
          jsonRpc: r.jsonRpc,
          grpc: r.grpc,
          speedup: r.jsonRpc.avgTimeMs / r.grpc.avgTimeMs,
        })),
      },
      null,
      2
    )
  );
  console.log(`Results saved to ${outputPath}`);
}

function printResultsTable(
  results: { jsonRpc: BenchmarkResult; grpc: BenchmarkResult }[]
) {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                  RESULTS SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const table = new Table({
    head: ['Benchmark', 'Transport', 'Avg', 'P50', 'P95', 'P99', 'Ops/sec'],
    style: { head: ['cyan'] },
  });

  for (const { jsonRpc, grpc } of results) {
    table.push(
      [
        jsonRpc.name,
        'JSON-RPC',
        formatMs(jsonRpc.avgTimeMs),
        formatMs(jsonRpc.p50Ms),
        formatMs(jsonRpc.p95Ms),
        formatMs(jsonRpc.p99Ms),
        jsonRpc.opsPerSecond.toFixed(0),
      ],
      [
        '',
        'gRPC',
        formatMs(grpc.avgTimeMs),
        formatMs(grpc.p50Ms),
        formatMs(grpc.p95Ms),
        formatMs(grpc.p99Ms),
        grpc.opsPerSecond.toFixed(0),
      ],
      [
        '',
        '→ Speedup',
        `${(jsonRpc.avgTimeMs / grpc.avgTimeMs).toFixed(2)}x`,
        `${(jsonRpc.p50Ms / grpc.p50Ms).toFixed(2)}x`,
        `${(jsonRpc.p95Ms / grpc.p95Ms).toFixed(2)}x`,
        `${(jsonRpc.p99Ms / grpc.p99Ms).toFixed(2)}x`,
        `${(grpc.opsPerSecond / jsonRpc.opsPerSecond).toFixed(2)}x`,
      ]
    );

    // Add separator
    if (results.indexOf({ jsonRpc, grpc }) < results.length - 1) {
      table.push([{ colSpan: 7, content: '', hAlign: 'center' }]);
    }
  }

  console.log(table.toString());
  console.log('');

  // Summary
  const avgSpeedup =
    results.reduce((sum, r) => sum + r.jsonRpc.avgTimeMs / r.grpc.avgTimeMs, 0) /
    results.length;

  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log(`│  Overall Average Speedup: ${avgSpeedup.toFixed(2)}x faster with gRPC           │`);
  console.log('└────────────────────────────────────────────────────────────────┘');
  console.log('');
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
