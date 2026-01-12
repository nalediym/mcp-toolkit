#!/usr/bin/env tsx
/**
 * Serialization Benchmark
 *
 * Measures the raw overhead of JSON vs Protobuf serialization
 * This is a standalone test that doesn't require server setup.
 */

import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import Table from 'cli-table3';

// Since we may not have generated proto code yet, let's simulate
// the protobuf structure manually using @bufbuild/protobuf's reflection

// ═══════════════════════════════════════════════════════════════════════════
// Test Data Structures
// ═══════════════════════════════════════════════════════════════════════════

interface ToolCallJson {
  jsonrpc: '2.0';
  id: number;
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface ToolResultJson {
  jsonrpc: '2.0';
  id: number;
  result: {
    content: Array<{
      type: 'text';
      text: string;
    }>;
  };
}

// Simple protobuf-like binary encoding (manual implementation for benchmark)
// In real usage, this would be generated from .proto files

class BinaryEncoder {
  private buffer: number[] = [];

  writeVarint(value: number): void {
    while (value > 127) {
      this.buffer.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.buffer.push(value);
  }

  writeString(fieldNum: number, value: string): void {
    this.writeVarint((fieldNum << 3) | 2); // wire type 2 = length-delimited
    const bytes = new TextEncoder().encode(value);
    this.writeVarint(bytes.length);
    this.buffer.push(...bytes);
  }

  writeInt32(fieldNum: number, value: number): void {
    this.writeVarint((fieldNum << 3) | 0); // wire type 0 = varint
    this.writeVarint(value);
  }

  toBuffer(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

class BinaryDecoder {
  private pos = 0;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readVarint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.data[this.pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  readString(): string {
    const length = this.readVarint();
    const bytes = this.data.slice(this.pos, this.pos + length);
    this.pos += length;
    return new TextDecoder().decode(bytes);
  }

  hasMore(): boolean {
    return this.pos < this.data.length;
  }

  readTag(): { fieldNum: number; wireType: number } {
    const tag = this.readVarint();
    return {
      fieldNum: tag >>> 3,
      wireType: tag & 0x7,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Serialization Functions
// ═══════════════════════════════════════════════════════════════════════════

function serializeJsonToolCall(name: string, args: Record<string, unknown>): string {
  const msg: ToolCallJson = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  };
  return JSON.stringify(msg);
}

function deserializeJsonToolCall(data: string): ToolCallJson {
  return JSON.parse(data);
}

function serializeBinaryToolCall(name: string, args: Record<string, unknown>): Uint8Array {
  const encoder = new BinaryEncoder();
  encoder.writeString(1, name);
  encoder.writeString(2, JSON.stringify(args)); // Args as JSON bytes (pragmatic)
  return encoder.toBuffer();
}

function deserializeBinaryToolCall(data: Uint8Array): { name: string; args: Record<string, unknown> } {
  const decoder = new BinaryDecoder(data);
  let name = '';
  let args: Record<string, unknown> = {};

  while (decoder.hasMore()) {
    const tag = decoder.readTag();
    switch (tag.fieldNum) {
      case 1:
        name = decoder.readString();
        break;
      case 2:
        args = JSON.parse(decoder.readString());
        break;
    }
  }

  return { name, args };
}

function serializeJsonToolResult(text: string): string {
  const msg: ToolResultJson = {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text }],
    },
  };
  return JSON.stringify(msg);
}

function deserializeJsonToolResult(data: string): ToolResultJson {
  return JSON.parse(data);
}

function serializeBinaryToolResult(text: string): Uint8Array {
  const encoder = new BinaryEncoder();
  encoder.writeString(1, text);
  return encoder.toBuffer();
}

function deserializeBinaryToolResult(data: Uint8Array): { text: string } {
  const decoder = new BinaryDecoder(data);
  let text = '';

  while (decoder.hasMore()) {
    const tag = decoder.readTag();
    if (tag.fieldNum === 1) {
      text = decoder.readString();
    }
  }

  return { text };
}

// ═══════════════════════════════════════════════════════════════════════════
// Benchmark Runner
// ═══════════════════════════════════════════════════════════════════════════

interface BenchResult {
  name: string;
  iterations: number;
  jsonTimeMs: number;
  binaryTimeMs: number;
  jsonSizeBytes: number;
  binarySizeBytes: number;
}

function runBenchmark(
  name: string,
  iterations: number,
  jsonSerialize: () => string,
  jsonDeserialize: (data: string) => unknown,
  binarySerialize: () => Uint8Array,
  binaryDeserialize: (data: Uint8Array) => unknown
): BenchResult {
  // Warmup
  for (let i = 0; i < 100; i++) {
    jsonDeserialize(jsonSerialize());
    binaryDeserialize(binarySerialize());
  }

  // Measure JSON
  const jsonStart = performance.now();
  let jsonData = '';
  for (let i = 0; i < iterations; i++) {
    jsonData = jsonSerialize();
    jsonDeserialize(jsonData);
  }
  const jsonEnd = performance.now();

  // Measure Binary
  const binaryStart = performance.now();
  let binaryData = new Uint8Array();
  for (let i = 0; i < iterations; i++) {
    binaryData = binarySerialize();
    binaryDeserialize(binaryData);
  }
  const binaryEnd = performance.now();

  return {
    name,
    iterations,
    jsonTimeMs: jsonEnd - jsonStart,
    binaryTimeMs: binaryEnd - binaryStart,
    jsonSizeBytes: new TextEncoder().encode(jsonData).length,
    binarySizeBytes: binaryData.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Serialization Benchmark: JSON vs Binary (Protobuf)     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  const iterations = 10000;
  const results: BenchResult[] = [];

  // Test 1: Small tool call
  console.log('Running: Small tool call...');
  results.push(
    runBenchmark(
      'Small tool call',
      iterations,
      () => serializeJsonToolCall('echo', { message: 'hello' }),
      deserializeJsonToolCall,
      () => serializeBinaryToolCall('echo', { message: 'hello' }),
      deserializeBinaryToolCall
    )
  );

  // Test 2: Medium tool call
  console.log('Running: Medium tool call...');
  results.push(
    runBenchmark(
      'Medium tool call',
      iterations,
      () =>
        serializeJsonToolCall('search', {
          query: 'find all files matching pattern',
          directory: '/home/user/documents',
          recursive: true,
          maxResults: 100,
        }),
      deserializeJsonToolCall,
      () =>
        serializeBinaryToolCall('search', {
          query: 'find all files matching pattern',
          directory: '/home/user/documents',
          recursive: true,
          maxResults: 100,
        }),
      deserializeBinaryToolCall
    )
  );

  // Test 3: Small response
  console.log('Running: Small response...');
  results.push(
    runBenchmark(
      'Small response',
      iterations,
      () => serializeJsonToolResult('Result: 42'),
      deserializeJsonToolResult,
      () => serializeBinaryToolResult('Result: 42'),
      deserializeBinaryToolResult
    )
  );

  // Test 4: Large response (1KB)
  const largeText = 'x'.repeat(1000);
  console.log('Running: Large response (1KB)...');
  results.push(
    runBenchmark(
      'Large response (1KB)',
      iterations,
      () => serializeJsonToolResult(largeText),
      deserializeJsonToolResult,
      () => serializeBinaryToolResult(largeText),
      deserializeBinaryToolResult
    )
  );

  // Test 5: Very large response (10KB)
  const veryLargeText = 'x'.repeat(10000);
  console.log('Running: Very large response (10KB)...');
  results.push(
    runBenchmark(
      'Very large response (10KB)',
      iterations / 10, // Fewer iterations for large payloads
      () => serializeJsonToolResult(veryLargeText),
      deserializeJsonToolResult,
      () => serializeBinaryToolResult(veryLargeText),
      deserializeBinaryToolResult
    )
  );

  console.log('');

  // Print results
  const table = new Table({
    head: ['Test', 'Iterations', 'JSON (ms)', 'Binary (ms)', 'Speedup', 'JSON Size', 'Binary Size', 'Size Reduction'],
    style: { head: ['cyan'] },
  });

  for (const r of results) {
    const speedup = r.jsonTimeMs / r.binaryTimeMs;
    const sizeReduction = ((r.jsonSizeBytes - r.binarySizeBytes) / r.jsonSizeBytes) * 100;

    table.push([
      r.name,
      r.iterations,
      r.jsonTimeMs.toFixed(2),
      r.binaryTimeMs.toFixed(2),
      `${speedup.toFixed(2)}x`,
      `${r.jsonSizeBytes} B`,
      `${r.binarySizeBytes} B`,
      `${sizeReduction.toFixed(0)}%`,
    ]);
  }

  console.log(table.toString());
  console.log('');

  // Summary
  const avgSpeedup =
    results.reduce((sum, r) => sum + r.jsonTimeMs / r.binaryTimeMs, 0) / results.length;
  const avgSizeReduction =
    results.reduce(
      (sum, r) => sum + ((r.jsonSizeBytes - r.binarySizeBytes) / r.jsonSizeBytes) * 100,
      0
    ) / results.length;

  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log(`│  Average Speedup:       ${avgSpeedup.toFixed(2)}x faster                          │`);
  console.log(`│  Average Size Reduction: ${avgSizeReduction.toFixed(0)}% smaller                          │`);
  console.log('└────────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('Note: This measures pure serialization/deserialization overhead.');
  console.log('      Real-world gains depend on network latency and payload sizes.');
}

main();
