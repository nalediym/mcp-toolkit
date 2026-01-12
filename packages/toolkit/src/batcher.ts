/**
 * MCP Call Batcher
 *
 * Combines multiple tool calls into batched requests to reduce round-trip overhead.
 * This is particularly useful when making many small tool calls in quick succession.
 *
 * Features:
 * - Automatic batching of calls made within a time window
 * - Configurable batch size and timing
 * - Priority queue for urgent calls
 * - Statistics tracking
 *
 * @example
 * ```typescript
 * const batcher = new McpCallBatcher({
 *   executor: async (calls) => {
 *     // Execute multiple calls in parallel
 *     return Promise.all(calls.map(call =>
 *       mcpClient.callTool(call.name, call.args)
 *     ));
 *   },
 *   maxBatchSize: 10,
 *   maxWaitMs: 50,
 * });
 *
 * // These calls will be batched together
 * const [result1, result2, result3] = await Promise.all([
 *   batcher.call('tool1', { arg: 1 }),
 *   batcher.call('tool2', { arg: 2 }),
 *   batcher.call('tool3', { arg: 3 }),
 * ]);
 * ```
 */

import type { ToolCallResult, PendingToolCall, BatcherStats } from './types.js';

/**
 * A call in the batch queue
 */
interface QueuedCall {
  name: string;
  args: Record<string, unknown>;
  priority: number;
  resolve: (result: ToolCallResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Options for the call batcher
 */
export interface BatcherOptions {
  /**
   * Function to execute a batch of tool calls.
   * Should return results in the same order as the input calls.
   */
  executor: (calls: Array<{ name: string; args: Record<string, unknown> }>) => Promise<ToolCallResult[]>;

  /**
   * Maximum number of calls to batch together.
   * Default: 10
   */
  maxBatchSize?: number;

  /**
   * Maximum time to wait for more calls before executing the batch (ms).
   * Default: 50
   */
  maxWaitMs?: number;

  /**
   * Whether to execute immediately when batch is full.
   * Default: true
   */
  executeOnFull?: boolean;

  /**
   * Callback when a batch is executed
   */
  onBatch?: (batchSize: number, duration: number) => void;
}

/**
 * MCP Call Batcher
 *
 * Batches multiple tool calls together to reduce overhead.
 */
export class McpCallBatcher {
  private queue: QueuedCall[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private options: Required<Omit<BatcherOptions, 'onBatch'>> & { onBatch?: BatcherOptions['onBatch'] };
  private stats: BatcherStats = {
    totalCalls: 0,
    totalBatches: 0,
    averageBatchSize: 0,
    callsSaved: 0,
  };
  private isExecuting = false;

  constructor(options: BatcherOptions) {
    this.options = {
      maxBatchSize: options.maxBatchSize ?? 10,
      maxWaitMs: options.maxWaitMs ?? 50,
      executeOnFull: options.executeOnFull ?? true,
      executor: options.executor,
      onBatch: options.onBatch,
    };
  }

  /**
   * Queue a tool call for batching.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param priority - Higher priority calls are executed first (default: 0)
   * @returns Promise that resolves with the tool call result
   */
  call(name: string, args: Record<string, unknown> = {}, priority = 0): Promise<ToolCallResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        name,
        args,
        priority,
        resolve,
        reject,
        timestamp: Date.now(),
      });

      this.stats.totalCalls++;

      // Sort by priority (higher first), then by timestamp (older first)
      this.queue.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.timestamp - b.timestamp;
      });

      // Check if we should execute immediately
      if (this.options.executeOnFull && this.queue.length >= this.options.maxBatchSize) {
        this.flush();
      } else {
        this.scheduleFlush();
      }
    });
  }

  /**
   * Execute a call immediately, bypassing the batch queue.
   */
  async callImmediate(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    this.stats.totalCalls++;
    this.stats.totalBatches++;

    const results = await this.options.executor([{ name, args }]);
    return results[0];
  }

  /**
   * Flush the current batch immediately.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0 || this.isExecuting) {
      return;
    }

    this.isExecuting = true;

    // Take up to maxBatchSize calls
    const batch = this.queue.splice(0, this.options.maxBatchSize);
    const batchSize = batch.length;

    if (batchSize === 0) {
      this.isExecuting = false;
      return;
    }

    this.stats.totalBatches++;
    this.stats.callsSaved += batchSize - 1; // Saved N-1 round trips
    this.stats.averageBatchSize =
      (this.stats.averageBatchSize * (this.stats.totalBatches - 1) + batchSize) /
      this.stats.totalBatches;

    const startTime = Date.now();

    try {
      const calls = batch.map((c) => ({ name: c.name, args: c.args }));
      const results = await this.options.executor(calls);

      // Resolve each call with its result
      for (let i = 0; i < batch.length; i++) {
        if (results[i]) {
          batch[i].resolve(results[i]);
        } else {
          batch[i].reject(new Error(`No result returned for call ${i}`));
        }
      }

      const duration = Date.now() - startTime;
      this.options.onBatch?.(batchSize, duration);
    } catch (error) {
      // Reject all calls in the batch
      const err = error instanceof Error ? error : new Error(String(error));
      for (const call of batch) {
        call.reject(err);
      }
    } finally {
      this.isExecuting = false;

      // If there are more calls queued, schedule another flush
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Get current batching statistics.
   */
  getStats(): BatcherStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      totalCalls: 0,
      totalBatches: 0,
      averageBatchSize: 0,
      callsSaved: 0,
    };
  }

  /**
   * Get number of calls currently in the queue.
   */
  get pendingCalls(): number {
    return this.queue.length;
  }

  /**
   * Cancel all pending calls.
   */
  cancelAll(reason = 'Cancelled'): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const error = new Error(reason);
    for (const call of this.queue) {
      call.reject(error);
    }
    this.queue = [];
  }

  private scheduleFlush(): void {
    if (this.timer || this.isExecuting) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.options.maxWaitMs);
  }
}

/**
 * Create a simple parallel executor for use with McpCallBatcher.
 *
 * @param callFn - Function to call a single tool
 * @param concurrency - Maximum concurrent calls (default: unlimited)
 */
export function createParallelExecutor(
  callFn: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>,
  concurrency?: number
): BatcherOptions['executor'] {
  return async (calls) => {
    if (!concurrency || concurrency <= 0) {
      // Unlimited concurrency
      return Promise.all(calls.map((c) => callFn(c.name, c.args)));
    }

    // Limited concurrency
    const results: ToolCallResult[] = new Array(calls.length);
    const executing: Promise<void>[] = [];

    for (let i = 0; i < calls.length; i++) {
      const index = i;
      const call = calls[i];

      const promise = callFn(call.name, call.args).then((result) => {
        results[index] = result;
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        // Remove completed promises
        for (let j = executing.length - 1; j >= 0; j--) {
          const p = executing[j];
          // Check if promise is settled by racing with an already-resolved promise
          const isSettled = await Promise.race([
            p.then(() => true).catch(() => true),
            Promise.resolve(false),
          ]);
          if (isSettled) {
            executing.splice(j, 1);
          }
        }
      }
    }

    await Promise.all(executing);
    return results;
  };
}

/**
 * Higher-order function that wraps a tool call function with batching.
 *
 * @example
 * ```typescript
 * const batchedCall = withBatching(mcpClient.callTool.bind(mcpClient), {
 *   maxBatchSize: 5,
 *   maxWaitMs: 100,
 * });
 *
 * // These will be batched
 * const results = await Promise.all([
 *   batchedCall('tool1', {}),
 *   batchedCall('tool2', {}),
 * ]);
 * ```
 */
export function withBatching(
  callFn: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>,
  options: Omit<BatcherOptions, 'executor'> & { concurrency?: number } = {}
): (name: string, args?: Record<string, unknown>) => Promise<ToolCallResult> {
  const { concurrency, ...batcherOptions } = options;

  const batcher = new McpCallBatcher({
    ...batcherOptions,
    executor: createParallelExecutor(callFn, concurrency),
  });

  const wrappedFn = (name: string, args: Record<string, unknown> = {}) => {
    return batcher.call(name, args);
  };

  // Attach batcher for access to stats/control
  (wrappedFn as any).batcher = batcher;

  return wrappedFn;
}
