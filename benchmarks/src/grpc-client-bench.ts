/**
 * gRPC Client Benchmark
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { McpClient, createHttpTransport } from '@grpc-mcp/client';
import { benchmark, warmup, calculateStats, type BenchmarkResult } from './utils.js';

let serverProcess: ChildProcess | null = null;
let client: McpClient | null = null;

const GRPC_PORT = 50052;
const SERVER_URL = `http://localhost:${GRPC_PORT}`;

export async function setup(): Promise<void> {
  // Start the gRPC server as a subprocess
  serverProcess = spawn('tsx', ['src/grpc-server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, GRPC_PORT: String(GRPC_PORT) },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Create client
  client = new McpClient({
    clientInfo: {
      name: 'grpc-benchmark-client',
      version: '1.0.0',
    },
  });

  const transport = createHttpTransport({ baseUrl: SERVER_URL });
  await client.connect(transport);
}

export async function teardown(): Promise<void> {
  if (client) {
    await client.disconnect();
  }
  if (serverProcess) {
    serverProcess.kill();
  }
}

export async function runEchoBenchmark(iterations: number): Promise<BenchmarkResult> {
  if (!client) throw new Error('Client not initialized');

  // Warmup
  await warmup(async () => {
    await client!.callTool('echo', { message: 'warmup' });
  }, 20);

  // Benchmark
  const timings = await benchmark(async () => {
    await client!.callTool('echo', { message: 'hello world' });
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: 'echo',
    transport: 'grpc',
    iterations,
    ...stats,
  };
}

export async function runComputeBenchmark(iterations: number): Promise<BenchmarkResult> {
  if (!client) throw new Error('Client not initialized');

  await warmup(async () => {
    await client!.callTool('compute', { a: 1, b: 2 });
  }, 20);

  const timings = await benchmark(async () => {
    await client!.callTool('compute', { a: 42, b: 58 });
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: 'compute',
    transport: 'grpc',
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
    await client!.callTool('large_response', { size: 100 });
  }, 10);

  const timings = await benchmark(async () => {
    await client!.callTool('large_response', { size });
  }, iterations);

  const stats = calculateStats(timings);
  return {
    name: `large_response_${size}`,
    transport: 'grpc',
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
    transport: 'grpc',
    iterations,
    ...stats,
  };
}
