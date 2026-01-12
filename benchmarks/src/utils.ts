/**
 * Benchmark utilities
 */

export interface BenchmarkResult {
  name: string;
  transport: 'json-rpc' | 'grpc';
  iterations: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSecond: number;
}

export function calculateStats(timings: number[]): Omit<BenchmarkResult, 'name' | 'transport' | 'iterations'> {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = timings.reduce((a, b) => a + b, 0);
  const avg = total / timings.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  return {
    totalTimeMs: total,
    avgTimeMs: avg,
    minTimeMs: min,
    maxTimeMs: max,
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    opsPerSecond: 1000 / avg,
  };
}

export async function warmup(fn: () => Promise<void>, iterations = 10): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
}

export async function benchmark(
  fn: () => Promise<void>,
  iterations: number
): Promise<number[]> {
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    timings.push(end - start);
  }

  return timings;
}

export function formatMs(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}μs`;
  }
  return `${ms.toFixed(2)}ms`;
}

export function formatComparison(grpc: number, jsonRpc: number): string {
  const ratio = jsonRpc / grpc;
  if (ratio > 1) {
    return `${ratio.toFixed(1)}x faster`;
  } else {
    return `${(1 / ratio).toFixed(1)}x slower`;
  }
}
