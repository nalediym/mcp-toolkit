/**
 * JSON-RPC Client Benchmark
 * Uses official MCP SDK client over stdio
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { benchmark, warmup, calculateStats, type BenchmarkResult } from './utils.js';

let serverProcess: ChildProcess | null = null;
let client: Client | null = null;

export async function setup(): Promise<void> {
  // Start the JSON-RPC server as a subprocess
  serverProcess = spawn('tsx', ['src/json-rpc-server.ts'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  // Create client with stdio transport
  const transport = new StdioClientTransport({
    command: 'tsx',
    args: ['src/json-rpc-server.ts'],
    cwd: process.cwd(),
  });

  client = new Client(
    {
      name: 'json-rpc-benchmark-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  // Wait a bit for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 500));
}

export async function teardown(): Promise<void> {
  if (client) {
    await client.close();
  }
  if (serverProcess) {
    serverProcess.kill();
  }
}

export async function runEchoBenchmark(iterations: number): Promise<BenchmarkResult> {
  if (!client) throw new Error('Client not initialized');

  // Warmup
  await warmup(async () => {
    await client!.callTool({ name: 'echo', arguments: { message: 'warmup' } });
  }, 20);

  // Benchmark
  const timings = await benchmark(async () => {
    await client!.callTool({ name: 'echo', arguments: { message: 'hello world' } });
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: 'echo',
    transport: 'json-rpc',
    iterations,
    ...stats,
  };
}

export async function runComputeBenchmark(iterations: number): Promise<BenchmarkResult> {
  if (!client) throw new Error('Client not initialized');

  await warmup(async () => {
    await client!.callTool({ name: 'compute', arguments: { a: 1, b: 2 } });
  }, 20);

  const timings = await benchmark(async () => {
    await client!.callTool({ name: 'compute', arguments: { a: 42, b: 58 } });
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: 'compute',
    transport: 'json-rpc',
    iterations,
    ...stats,
  };
}

export async function runLargeResponseBenchmark(
  iterations: number,
  size: number
): Promise<BenchmarkResult> {
  if (!client) throw new Error('Client not initialized');

  await warmup(async () => {
    await client!.callTool({ name: 'large_response', arguments: { size: 100 } });
  }, 10);

  const timings = await benchmark(async () => {
    await client!.callTool({ name: 'large_response', arguments: { size } });
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: `large_response_${size}`,
    transport: 'json-rpc',
    iterations,
    ...stats,
  };
}

export async function runListToolsBenchmark(iterations: number): Promise<BenchmarkResult> {
  if (!client) throw new Error('Client not initialized');

  await warmup(async () => {
    await client!.listTools();
  }, 20);

  const timings = await benchmark(async () => {
    await client!.listTools();
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: 'list_tools',
    transport: 'json-rpc',
    iterations,
    ...stats,
  };
}
