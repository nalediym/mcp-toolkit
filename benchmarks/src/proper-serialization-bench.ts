#!/usr/bin/env tsx
/**
 * Proper Serialization Benchmark
 *
 * Compares JSON-RPC serialization overhead vs simulated protobuf.
 * Uses TextEncoder/Decoder for fair comparison since both are doing string work.
 */

import Table from 'cli-table3';

// ═══════════════════════════════════════════════════════════════════════════
// JSON-RPC Structures (what MCP actually sends)
// ═══════════════════════════════════════════════════════════════════════════

interface JsonRpcToolCall {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface JsonRpcToolResult {
  jsonrpc: '2.0';
  id: number;
  result: {
    content: Array<{ type: 'text'; text: string }>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Minimal Binary Protocol (simulating protobuf wire format)
// Uses DataView for efficient binary operations
// ═══════════════════════════════════════════════════════════════════════════

class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private pos = 0;

  constructor(size = 4096) {
    this.buffer = new ArrayBuffer(size);
    this.view = new DataView(this.buffer);
  }

  writeVarInt(value: number): void {
    while (value > 127) {
      this.view.setUint8(this.pos++, (value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.view.setUint8(this.pos++, value);
  }

  writeString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.writeVarInt(bytes.length);
    new Uint8Array(this.buffer, this.pos).set(bytes);
    this.pos += bytes.length;
  }

  writeField(fieldNum: number, value: string): void {
    this.writeVarInt((fieldNum << 3) | 2);
    this.writeString(value);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this.pos);
  }
}

class BinaryReader {
  private view: DataView;
  private pos = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readVarInt(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.view.getUint8(this.pos++);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  readString(): string {
    const length = this.readVarInt();
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, length);
    this.pos += length;
    return new TextDecoder().decode(bytes);
  }

  hasMore(): boolean {
    return this.pos < this.view.byteLength;
  }

  readTag(): { fieldNum: number; wireType: number } {
    const tag = this.readVarInt();
    return { fieldNum: tag >>> 3, wireType: tag & 0x7 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Benchmark Functions
// ═══════════════════════════════════════════════════════════════════════════

function benchmarkJson(createMsg: () => object, iterations: number) {
  const msg = createMsg();

  // Warmup
  for (let i = 0; i < 1000; i++) {
    JSON.parse(JSON.stringify(msg));
  }

  // Force GC if available
  if (global.gc) global.gc();

  const start = performance.now();
  let serialized = '';
  for (let i = 0; i < iterations; i++) {
    serialized = JSON.stringify(msg);
    JSON.parse(serialized);
  }
  const end = performance.now();

  return {
    timeMs: end - start,
    sizeBytes: new TextEncoder().encode(serialized).length,
    opsPerSec: iterations / ((end - start) / 1000),
  };
}

function benchmarkBinary(
  serialize: () => Uint8Array,
  deserialize: (data: Uint8Array) => void,
  iterations: number
) {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    deserialize(serialize());
  }

  // Force GC if available
  if (global.gc) global.gc();

  const start = performance.now();
  let serialized = new Uint8Array();
  for (let i = 0; i < iterations; i++) {
    serialized = serialize();
    deserialize(serialized);
  }
  const end = performance.now();

  return {
    timeMs: end - start,
    sizeBytes: serialized.length,
    opsPerSec: iterations / ((end - start) / 1000),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Test Cases
// ═══════════════════════════════════════════════════════════════════════════

interface BenchResult {
  name: string;
  iterations: number;
  jsonTimeMs: number;
  binaryTimeMs: number;
  jsonSizeBytes: number;
  binarySizeBytes: number;
  jsonOpsPerSec: number;
  binaryOpsPerSec: number;
}

function runToolCallBenchmark(
  name: string,
  toolName: string,
  args: Record<string, unknown>,
  iterations: number
): BenchResult {
  // JSON-RPC format
  const jsonResult = benchmarkJson(
    () => ({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    iterations
  );

  // Binary format (just name + args JSON)
  const argsJson = JSON.stringify(args);
  const binaryResult = benchmarkBinary(
    () => {
      const writer = new BinaryWriter();
      writer.writeField(1, toolName);
      writer.writeField(2, argsJson);
      return writer.toUint8Array();
    },
    (data) => {
      const reader = new BinaryReader(data);
      while (reader.hasMore()) {
        const tag = reader.readTag();
        reader.readString();
      }
    },
    iterations
  );

  return {
    name,
    iterations,
    jsonTimeMs: jsonResult.timeMs,
    binaryTimeMs: binaryResult.timeMs,
    jsonSizeBytes: jsonResult.sizeBytes,
    binarySizeBytes: binaryResult.sizeBytes,
    jsonOpsPerSec: jsonResult.opsPerSec,
    binaryOpsPerSec: binaryResult.opsPerSec,
  };
}

function runResponseBenchmark(name: string, text: string, iterations: number): BenchResult {
  // JSON-RPC format
  const jsonResult = benchmarkJson(
    () => ({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text }] },
    }),
    iterations
  );

  // Binary format (just text)
  const binaryResult = benchmarkBinary(
    () => {
      const writer = new BinaryWriter(text.length + 100);
      writer.writeField(1, text);
      return writer.toUint8Array();
    },
    (data) => {
      const reader = new BinaryReader(data);
      while (reader.hasMore()) {
        const tag = reader.readTag();
        reader.readString();
      }
    },
    iterations
  );

  return {
    name,
    iterations,
    jsonTimeMs: jsonResult.timeMs,
    binaryTimeMs: binaryResult.timeMs,
    jsonSizeBytes: jsonResult.sizeBytes,
    binarySizeBytes: binaryResult.sizeBytes,
    jsonOpsPerSec: jsonResult.opsPerSec,
    binaryOpsPerSec: binaryResult.opsPerSec,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       Serialization Benchmark: JSON-RPC vs Binary Protocol     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Methodology:');
  console.log('  - JSON: Full JSON-RPC 2.0 envelope (jsonrpc, id, method, params)');
  console.log('  - Binary: Minimal varint-length-prefixed fields (protobuf-like)');
  console.log('  - Both include encode + decode cycle');
  console.log('');

  const results: BenchResult[] = [];
  const iterations = 100000;

  // Test 1: Small tool call
  console.log('Running: Small tool call...');
  results.push(runToolCallBenchmark('Small tool call', 'echo', { message: 'hello' }, iterations));

  // Test 2: Medium tool call
  console.log('Running: Medium tool call...');
  results.push(
    runToolCallBenchmark(
      'Medium tool call',
      'search',
      {
        query: 'find all files',
        directory: '/home/user',
        recursive: true,
        maxResults: 100,
      },
      iterations
    )
  );

  // Test 3: Small response
  console.log('Running: Small response...');
  results.push(runResponseBenchmark('Small response', 'Result: 42', iterations));

  // Test 4: Large response (1KB)
  console.log('Running: Large response (1KB)...');
  results.push(runResponseBenchmark('Large response (1KB)', 'x'.repeat(1000), iterations / 2));

  // Test 5: Very large response (10KB)
  console.log('Running: Very large response (10KB)...');
  results.push(runResponseBenchmark('Very large (10KB)', 'x'.repeat(10000), iterations / 10));

  console.log('');

  // Print results
  const table = new Table({
    head: ['Test', 'Iter', 'JSON (ms)', 'Binary (ms)', 'Speedup', 'JSON', 'Binary', 'Size Δ'],
    style: { head: ['cyan'] },
    colWidths: [22, 8, 11, 12, 12, 8, 8, 8],
  });

  for (const r of results) {
    const speedup = r.jsonTimeMs / r.binaryTimeMs;
    const sizeReduction = ((r.jsonSizeBytes - r.binarySizeBytes) / r.jsonSizeBytes) * 100;

    table.push([
      r.name,
      r.iterations,
      r.jsonTimeMs.toFixed(1),
      r.binaryTimeMs.toFixed(1),
      speedup >= 1 ? `${speedup.toFixed(2)}x ✓` : `${(1 / speedup).toFixed(2)}x ✗`,
      `${r.jsonSizeBytes}B`,
      `${r.binarySizeBytes}B`,
      `-${sizeReduction.toFixed(0)}%`,
    ]);
  }

  console.log(table.toString());
  console.log('');

  // Calculate averages
  const avgSpeedup = results.reduce((sum, r) => sum + r.jsonTimeMs / r.binaryTimeMs, 0) / results.length;
  const avgSizeReduction =
    results.reduce((sum, r) => sum + ((r.jsonSizeBytes - r.binarySizeBytes) / r.jsonSizeBytes) * 100, 0) /
    results.length;

  console.log('┌─────────────────────────────────────────────────────────────────┐');
  if (avgSpeedup >= 1) {
    console.log(`│  Average Speedup:        ${avgSpeedup.toFixed(2)}x faster with Binary            │`);
  } else {
    console.log(`│  Average Speedup:        ${(1 / avgSpeedup).toFixed(2)}x SLOWER with Binary           │`);
  }
  console.log(`│  Average Size Reduction: ${avgSizeReduction.toFixed(0)}% smaller                            │`);
  console.log('└─────────────────────────────────────────────────────────────────┘');
  console.log('');

  // Ops per second comparison
  console.log('Operations per second:');
  const opsTable = new Table({
    head: ['Test', 'JSON ops/s', 'Binary ops/s', 'Δ'],
    style: { head: ['cyan'] },
  });

  for (const r of results) {
    const delta = ((r.binaryOpsPerSec - r.jsonOpsPerSec) / r.jsonOpsPerSec) * 100;
    opsTable.push([
      r.name,
      Math.round(r.jsonOpsPerSec).toLocaleString(),
      Math.round(r.binaryOpsPerSec).toLocaleString(),
      `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`,
    ]);
  }

  console.log(opsTable.toString());
}

main();
