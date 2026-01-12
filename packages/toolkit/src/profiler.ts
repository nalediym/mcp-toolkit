/**
 * MCP Profiler
 *
 * Measures where time goes in MCP workflows to identify performance bottlenecks.
 *
 * Features:
 * - Hierarchical timing (nested operations)
 * - Automatic aggregation and statistics
 * - Multiple output formats (console, JSON, structured)
 * - Async operation tracking
 * - Memory usage tracking
 * - Waterfall visualization
 *
 * @example
 * ```typescript
 * const profiler = new McpProfiler();
 *
 * // Start a profiling session
 * const session = profiler.startSession('my-workflow');
 *
 * // Time operations
 * session.time('fetch-tools', async () => {
 *   return await client.listTools();
 * });
 *
 * session.time('call-tool', async () => {
 *   session.time('serialize', () => JSON.stringify(args));
 *   const result = await client.callTool('my-tool', args);
 *   session.time('deserialize', () => JSON.parse(result));
 *   return result;
 * });
 *
 * // End session and get report
 * const report = session.end();
 * profiler.printReport(report);
 * ```
 */

import type { TimingEntry, ProfilerReport } from './types.js';

/**
 * A profiling session for tracking timing data
 */
export class ProfilingSession {
  private name: string;
  private startTime: number;
  private entries: TimingEntry[] = [];
  private stack: TimingEntry[] = [];
  private ended = false;
  private memoryStart?: number;

  constructor(name: string) {
    this.name = name;
    this.startTime = performance.now();

    // Track memory if available
    if (typeof process !== 'undefined' && process.memoryUsage) {
      this.memoryStart = process.memoryUsage().heapUsed;
    }
  }

  /**
   * Time a synchronous or asynchronous operation.
   *
   * @param operation - Name of the operation
   * @param fn - Function to execute and time
   * @param metadata - Optional metadata to attach
   * @returns The result of the function
   */
  time<T>(operation: string, fn: () => T, metadata?: Record<string, unknown>): T;
  time<T>(operation: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T>;
  time<T>(
    operation: string,
    fn: () => T | Promise<T>,
    metadata?: Record<string, unknown>
  ): T | Promise<T> {
    const entry = this.startTiming(operation, metadata);

    try {
      const result = fn();

      if (result instanceof Promise) {
        return result.then(
          (value) => {
            this.endTiming(entry);
            return value;
          },
          (error) => {
            this.endTiming(entry, error);
            throw error;
          }
        );
      }

      this.endTiming(entry);
      return result;
    } catch (error) {
      this.endTiming(entry, error);
      throw error;
    }
  }

  /**
   * Start timing an operation manually (for cases where time() isn't suitable).
   *
   * @param operation - Name of the operation
   * @param metadata - Optional metadata
   * @returns A function to call when the operation completes
   */
  start(operation: string, metadata?: Record<string, unknown>): () => void {
    const entry = this.startTiming(operation, metadata);
    return () => this.endTiming(entry);
  }

  /**
   * Record a completed operation with known duration.
   *
   * @param operation - Name of the operation
   * @param durationMs - Duration in milliseconds
   * @param metadata - Optional metadata
   */
  record(operation: string, durationMs: number, metadata?: Record<string, unknown>): void {
    const now = performance.now();
    const entry: TimingEntry = {
      name: this.name,
      operation,
      startTime: now - durationMs,
      endTime: now,
      duration: durationMs,
      metadata,
      children: [],
    };

    this.addEntry(entry);
  }

  /**
   * Add a marker at the current time (zero-duration entry).
   *
   * @param name - Marker name
   * @param metadata - Optional metadata
   */
  mark(name: string, metadata?: Record<string, unknown>): void {
    this.record(name, 0, metadata);
  }

  /**
   * End the profiling session and generate a report.
   */
  end(): ProfilerReport {
    if (this.ended) {
      throw new Error('Session already ended');
    }
    this.ended = true;

    // Close any unclosed entries
    while (this.stack.length > 0) {
      const entry = this.stack.pop()!;
      entry.endTime = performance.now();
      entry.duration = entry.endTime - entry.startTime;
    }

    const totalDuration = performance.now() - this.startTime;

    // Add memory info if available
    const memoryInfo: Record<string, unknown> = {};
    if (this.memoryStart !== undefined && typeof process !== 'undefined' && process.memoryUsage) {
      const memoryEnd = process.memoryUsage().heapUsed;
      memoryInfo.memoryDelta = memoryEnd - this.memoryStart;
      memoryInfo.memoryStart = this.memoryStart;
      memoryInfo.memoryEnd = memoryEnd;
    }

    // Calculate summary statistics
    const summary = this.calculateSummary(this.entries);

    return {
      totalDuration,
      entries: this.entries,
      summary,
      ...memoryInfo,
    } as ProfilerReport;
  }

  /**
   * Check if the session has ended.
   */
  get isEnded(): boolean {
    return this.ended;
  }

  /**
   * Get current duration (session doesn't need to be ended).
   */
  get currentDuration(): number {
    return performance.now() - this.startTime;
  }

  private startTiming(operation: string, metadata?: Record<string, unknown>): TimingEntry {
    if (this.ended) {
      throw new Error('Cannot time after session has ended');
    }

    const entry: TimingEntry = {
      name: this.name,
      operation,
      startTime: performance.now(),
      metadata,
      children: [],
    };

    this.addEntry(entry);
    this.stack.push(entry);

    return entry;
  }

  private endTiming(entry: TimingEntry, error?: unknown): void {
    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;

    if (error) {
      entry.metadata = {
        ...entry.metadata,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Pop from stack
    const index = this.stack.indexOf(entry);
    if (index >= 0) {
      this.stack.splice(index, 1);
    }
  }

  private addEntry(entry: TimingEntry): void {
    // If there's a parent on the stack, add as child
    if (this.stack.length > 0) {
      const parent = this.stack[this.stack.length - 1];
      parent.children.push(entry);
    } else {
      this.entries.push(entry);
    }
  }

  private calculateSummary(
    entries: TimingEntry[],
    summary: ProfilerReport['summary'] = {}
  ): ProfilerReport['summary'] {
    for (const entry of entries) {
      if (entry.duration === undefined) continue;

      if (!summary[entry.operation]) {
        summary[entry.operation] = {
          count: 0,
          totalTime: 0,
          avgTime: 0,
          minTime: Infinity,
          maxTime: -Infinity,
        };
      }

      const stats = summary[entry.operation];
      stats.count++;
      stats.totalTime += entry.duration;
      stats.avgTime = stats.totalTime / stats.count;
      stats.minTime = Math.min(stats.minTime, entry.duration);
      stats.maxTime = Math.max(stats.maxTime, entry.duration);

      // Recurse into children
      if (entry.children.length > 0) {
        this.calculateSummary(entry.children, summary);
      }
    }

    return summary;
  }
}

/**
 * MCP Profiler - manages profiling sessions and generates reports
 */
export class McpProfiler {
  private sessions = new Map<string, ProfilingSession>();
  private completedReports: ProfilerReport[] = [];
  private maxCompletedReports: number;

  constructor(options: { maxCompletedReports?: number } = {}) {
    this.maxCompletedReports = options.maxCompletedReports ?? 100;
  }

  /**
   * Start a new profiling session.
   *
   * @param name - Session name
   * @returns The profiling session
   */
  startSession(name: string): ProfilingSession {
    if (this.sessions.has(name)) {
      throw new Error(`Session "${name}" already exists`);
    }

    const session = new ProfilingSession(name);
    this.sessions.set(name, session);
    return session;
  }

  /**
   * Get an existing session.
   *
   * @param name - Session name
   */
  getSession(name: string): ProfilingSession | undefined {
    return this.sessions.get(name);
  }

  /**
   * End a session and store its report.
   *
   * @param name - Session name
   * @returns The profiler report
   */
  endSession(name: string): ProfilerReport {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`Session "${name}" not found`);
    }

    const report = session.end();
    this.sessions.delete(name);

    this.completedReports.push(report);
    if (this.completedReports.length > this.maxCompletedReports) {
      this.completedReports.shift();
    }

    return report;
  }

  /**
   * Get all completed reports.
   */
  getCompletedReports(): ProfilerReport[] {
    return [...this.completedReports];
  }

  /**
   * Clear completed reports.
   */
  clearReports(): void {
    this.completedReports = [];
  }

  /**
   * Time a single operation without a full session.
   *
   * @param operation - Operation name
   * @param fn - Function to time
   */
  async timeOnce<T>(operation: string, fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }

  /**
   * Print a report to the console.
   *
   * @param report - The report to print
   * @param options - Formatting options
   */
  printReport(
    report: ProfilerReport,
    options: { showWaterfall?: boolean; showSummary?: boolean; indent?: string } = {}
  ): void {
    const { showWaterfall = true, showSummary = true, indent = '  ' } = options;

    console.log('\n========================================');
    console.log(`Profiler Report - Total: ${report.totalDuration.toFixed(2)}ms`);
    console.log('========================================\n');

    if (showWaterfall && report.entries.length > 0) {
      console.log('Timeline:');
      console.log('---------');
      this.printEntries(report.entries, indent, 0);
      console.log('');
    }

    if (showSummary && Object.keys(report.summary).length > 0) {
      console.log('Summary by Operation:');
      console.log('--------------------');

      const sorted = Object.entries(report.summary).sort(
        ([, a], [, b]) => b.totalTime - a.totalTime
      );

      for (const [op, stats] of sorted) {
        console.log(`${op}:`);
        console.log(`${indent}Count: ${stats.count}`);
        console.log(`${indent}Total: ${stats.totalTime.toFixed(2)}ms`);
        console.log(`${indent}Avg: ${stats.avgTime.toFixed(2)}ms`);
        console.log(`${indent}Min: ${stats.minTime.toFixed(2)}ms`);
        console.log(`${indent}Max: ${stats.maxTime.toFixed(2)}ms`);
      }
    }

    console.log('');
  }

  /**
   * Format report as JSON string.
   */
  formatAsJson(report: ProfilerReport, pretty = true): string {
    return JSON.stringify(report, null, pretty ? 2 : undefined);
  }

  /**
   * Generate a simple ASCII waterfall chart.
   */
  generateWaterfall(report: ProfilerReport, width = 60): string {
    const lines: string[] = [];
    const total = report.totalDuration;

    const processEntry = (entry: TimingEntry, depth: number): void => {
      if (entry.duration === undefined || entry.startTime === undefined) return;

      const indent = '  '.repeat(depth);
      const startPct = (entry.startTime / total) * 100;
      const widthPct = (entry.duration / total) * 100;

      const startPos = Math.floor((startPct / 100) * width);
      const barWidth = Math.max(1, Math.floor((widthPct / 100) * width));

      const bar = ' '.repeat(startPos) + '|'.repeat(barWidth);
      const label = `${entry.operation} (${entry.duration.toFixed(1)}ms)`;

      lines.push(`${indent}${label}`);
      lines.push(`${indent}${bar}`);

      for (const child of entry.children) {
        processEntry(child, depth + 1);
      }
    };

    for (const entry of report.entries) {
      processEntry(entry, 0);
    }

    return lines.join('\n');
  }

  private printEntries(entries: TimingEntry[], indent: string, depth: number): void {
    const prefix = indent.repeat(depth);

    for (const entry of entries) {
      const duration = entry.duration?.toFixed(2) ?? '?';
      const error = entry.metadata?.error ? ' [ERROR]' : '';
      console.log(`${prefix}${entry.operation}: ${duration}ms${error}`);

      if (entry.children.length > 0) {
        this.printEntries(entry.children, indent, depth + 1);
      }
    }
  }
}

/**
 * Decorator/wrapper for profiling MCP client methods.
 *
 * @example
 * ```typescript
 * const profiledClient = profileMcpClient(mcpClient, profiler.startSession('client-ops'));
 *
 * // All calls are now profiled
 * await profiledClient.listTools();
 * await profiledClient.callTool('my-tool', {});
 *
 * const report = session.end();
 * ```
 */
export function profileMcpClient<T extends object>(
  client: T,
  session: ProfilingSession
): T {
  return new Proxy(client, {
    get(target, prop) {
      const value = (target as any)[prop];

      if (typeof value === 'function') {
        return function (...args: unknown[]) {
          const methodName = String(prop);

          return session.time(
            methodName,
            () => value.apply(target, args),
            { args: args.length }
          );
        };
      }

      return value;
    },
  });
}

/**
 * Create a middleware-style profiler for request/response patterns.
 *
 * @example
 * ```typescript
 * const middleware = createProfilingMiddleware();
 *
 * // Wrap your call function
 * const profiledCall = (name: string, args: unknown) => {
 *   const ctx = middleware.before(name, args);
 *   try {
 *     const result = originalCall(name, args);
 *     middleware.after(ctx, result);
 *     return result;
 *   } catch (error) {
 *     middleware.error(ctx, error);
 *     throw error;
 *   }
 * };
 *
 * // Get aggregated stats
 * console.log(middleware.getStats());
 * ```
 */
export function createProfilingMiddleware(): {
  before(operation: string, input?: unknown): { operation: string; startTime: number; input?: unknown };
  after(ctx: { operation: string; startTime: number }, output?: unknown): void;
  error(ctx: { operation: string; startTime: number }, error: unknown): void;
  getStats(): Record<string, { count: number; totalTime: number; avgTime: number; errors: number }>;
  reset(): void;
} {
  const stats: Record<string, { count: number; totalTime: number; avgTime: number; errors: number }> = {};

  return {
    before(operation: string, input?: unknown) {
      return {
        operation,
        startTime: performance.now(),
        input,
      };
    },

    after(ctx, _output) {
      const duration = performance.now() - ctx.startTime;

      if (!stats[ctx.operation]) {
        stats[ctx.operation] = { count: 0, totalTime: 0, avgTime: 0, errors: 0 };
      }

      const s = stats[ctx.operation];
      s.count++;
      s.totalTime += duration;
      s.avgTime = s.totalTime / s.count;
    },

    error(ctx, _error) {
      const duration = performance.now() - ctx.startTime;

      if (!stats[ctx.operation]) {
        stats[ctx.operation] = { count: 0, totalTime: 0, avgTime: 0, errors: 0 };
      }

      const s = stats[ctx.operation];
      s.count++;
      s.totalTime += duration;
      s.avgTime = s.totalTime / s.count;
      s.errors++;
    },

    getStats() {
      return { ...stats };
    },

    reset() {
      for (const key of Object.keys(stats)) {
        delete stats[key];
      }
    },
  };
}

/**
 * Simple performance measurement helper.
 *
 * @example
 * ```typescript
 * const measure = createMeasure();
 *
 * measure.start('operation1');
 * // ... do work ...
 * measure.end('operation1');
 *
 * measure.start('operation2');
 * // ... do work ...
 * measure.end('operation2');
 *
 * console.log(measure.getResults());
 * // { operation1: 123.45, operation2: 67.89 }
 * ```
 */
export function createMeasure(): {
  start(name: string): void;
  end(name: string): number;
  getResults(): Record<string, number>;
  clear(): void;
} {
  const starts = new Map<string, number>();
  const results: Record<string, number> = {};

  return {
    start(name: string) {
      starts.set(name, performance.now());
    },

    end(name: string): number {
      const start = starts.get(name);
      if (start === undefined) {
        throw new Error(`No start time for "${name}"`);
      }
      const duration = performance.now() - start;
      results[name] = duration;
      starts.delete(name);
      return duration;
    },

    getResults() {
      return { ...results };
    },

    clear() {
      starts.clear();
      for (const key of Object.keys(results)) {
        delete results[key];
      }
    },
  };
}
