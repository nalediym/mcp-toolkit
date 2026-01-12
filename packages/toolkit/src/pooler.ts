/**
 * MCP Connection Pooler
 *
 * Manages a pool of MCP connections for reuse, reducing connection overhead.
 *
 * Features:
 * - Connection reuse with configurable pool size
 * - Automatic connection health checking
 * - Idle connection cleanup
 * - Connection timeout handling
 * - Statistics tracking
 * - Support for multiple server URLs
 *
 * @example
 * ```typescript
 * const pool = new McpConnectionPool({
 *   factory: async (options) => {
 *     const client = new McpClient({ clientInfo: { name: 'my-app', version: '1.0.0' } });
 *     await client.connect(createConnectTransport({ baseUrl: options.url }));
 *     return wrapMcpClient(client);
 *   },
 *   minConnections: 2,
 *   maxConnections: 10,
 * });
 *
 * // Acquire a connection
 * const conn = await pool.acquire({ url: 'http://localhost:50051' });
 *
 * try {
 *   const result = await conn.callTool('my-tool', { arg: 'value' });
 * } finally {
 *   // Return connection to pool
 *   pool.release(conn);
 * }
 *
 * // Or use the convenient withConnection helper
 * const result = await pool.withConnection({ url: 'http://localhost:50051' }, async (conn) => {
 *   return conn.callTool('my-tool', { arg: 'value' });
 * });
 * ```
 */

import type {
  McpConnection,
  ConnectionFactory,
  ConnectionOptions,
  PoolStats,
  ToolCallResult,
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
} from './types.js';

/**
 * Internal connection wrapper with pool metadata
 */
interface PooledConnection {
  connection: McpConnection;
  url: string;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  isHealthy: boolean;
}

/**
 * Queued request waiting for a connection
 */
interface QueuedRequest {
  url: string;
  resolve: (conn: McpConnection) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  timestamp: number;
}

/**
 * Options for the connection pool
 */
export interface PoolOptions {
  /** Factory function to create new connections */
  factory: ConnectionFactory;

  /** Minimum connections to maintain per URL. Default: 0 */
  minConnections?: number;

  /** Maximum connections per URL. Default: 10 */
  maxConnections?: number;

  /** Maximum total connections across all URLs. Default: 50 */
  maxTotalConnections?: number;

  /** Connection idle timeout in ms before closing. Default: 60000 (1 minute) */
  idleTimeoutMs?: number;

  /** Maximum time to wait for a connection in ms. Default: 30000 (30 seconds) */
  acquireTimeoutMs?: number;

  /** How often to check connection health in ms. Default: 30000 (30 seconds) */
  healthCheckIntervalMs?: number;

  /** Maximum age of a connection before forced refresh in ms. Default: 300000 (5 minutes) */
  maxConnectionAgeMs?: number;

  /** Whether to validate connections before returning them. Default: true */
  validateOnAcquire?: boolean;

  /** Callback when a connection is created */
  onCreate?: (conn: McpConnection) => void;

  /** Callback when a connection is destroyed */
  onDestroy?: (conn: McpConnection) => void;

  /** Callback on error */
  onError?: (error: Error, conn?: McpConnection) => void;
}

/**
 * MCP Connection Pool
 *
 * Manages reusable connections to MCP servers.
 */
export class McpConnectionPool {
  private pools = new Map<string, PooledConnection[]>();
  private activeConnections = new Map<string, PooledConnection>();
  private waitingRequests: QueuedRequest[] = [];
  private options: Required<Omit<PoolOptions, 'onCreate' | 'onDestroy' | 'onError'>> & Pick<PoolOptions, 'onCreate' | 'onDestroy' | 'onError'>;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private stats = {
    totalCreated: 0,
    totalReused: 0,
    totalDestroyed: 0,
    acquireTimeouts: 0,
    healthCheckFailures: 0,
  };
  private isShuttingDown = false;

  constructor(options: PoolOptions) {
    this.options = {
      minConnections: options.minConnections ?? 0,
      maxConnections: options.maxConnections ?? 10,
      maxTotalConnections: options.maxTotalConnections ?? 50,
      idleTimeoutMs: options.idleTimeoutMs ?? 60000,
      acquireTimeoutMs: options.acquireTimeoutMs ?? 30000,
      healthCheckIntervalMs: options.healthCheckIntervalMs ?? 30000,
      maxConnectionAgeMs: options.maxConnectionAgeMs ?? 300000,
      validateOnAcquire: options.validateOnAcquire ?? true,
      factory: options.factory,
      onCreate: options.onCreate,
      onDestroy: options.onDestroy,
      onError: options.onError,
    };

    // Start background maintenance
    this.startHealthCheck();
    this.startIdleCheck();
  }

  /**
   * Acquire a connection from the pool.
   *
   * @param options - Connection options (must include url)
   * @returns A connection from the pool
   */
  async acquire(options: ConnectionOptions): Promise<McpConnection> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }

    const { url } = options;

    // Try to get an existing idle connection
    const existing = await this.getIdleConnection(url);
    if (existing) {
      this.stats.totalReused++;
      return existing;
    }

    // Try to create a new connection
    const created = await this.tryCreateConnection(options);
    if (created) {
      return created;
    }

    // Wait for a connection to become available
    return this.waitForConnection(url);
  }

  /**
   * Release a connection back to the pool.
   *
   * @param connection - The connection to release
   */
  release(connection: McpConnection): void {
    const pooled = this.activeConnections.get(connection.id);
    if (!pooled) {
      // Unknown connection - close it
      connection.close().catch(() => {});
      return;
    }

    this.activeConnections.delete(connection.id);
    pooled.lastUsedAt = Date.now();

    // Check if there are waiting requests for this URL
    const waitingIndex = this.waitingRequests.findIndex((r) => r.url === pooled.url);
    if (waitingIndex >= 0) {
      const waiting = this.waitingRequests.splice(waitingIndex, 1)[0];
      clearTimeout(waiting.timeoutId);
      this.activeConnections.set(connection.id, pooled);
      pooled.useCount++;
      this.stats.totalReused++;
      waiting.resolve(connection);
      return;
    }

    // Return to pool if healthy
    if (pooled.isHealthy) {
      const pool = this.getPool(pooled.url);
      pool.push(pooled);
    } else {
      this.destroyConnection(pooled);
    }
  }

  /**
   * Execute a function with a connection, automatically releasing it when done.
   *
   * @param options - Connection options
   * @param fn - Function to execute with the connection
   */
  async withConnection<T>(
    options: ConnectionOptions,
    fn: (conn: McpConnection) => Promise<T>
  ): Promise<T> {
    const conn = await this.acquire(options);
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  /**
   * Pre-warm the pool by creating minimum connections.
   *
   * @param urls - URLs to pre-warm
   */
  async warmup(urls: string[]): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const url of urls) {
      const pool = this.getPool(url);
      const needed = this.options.minConnections - pool.length;

      for (let i = 0; i < needed; i++) {
        promises.push(
          this.createConnection({ url }).then((pooled) => {
            pool.push(pooled);
          }).catch((err) => {
            this.options.onError?.(err);
          })
        );
      }
    }

    await Promise.all(promises);
  }

  /**
   * Get pool statistics.
   */
  getStats(): PoolStats {
    let totalConnections = 0;
    let activeConnections = this.activeConnections.size;
    let idleConnections = 0;

    for (const pool of this.pools.values()) {
      idleConnections += pool.length;
    }
    totalConnections = activeConnections + idleConnections;

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      waitingRequests: this.waitingRequests.length,
      totalCreated: this.stats.totalCreated,
      totalReused: this.stats.totalReused,
    };
  }

  /**
   * Get detailed stats including per-URL breakdown.
   */
  getDetailedStats(): PoolStats & { byUrl: Record<string, { idle: number; active: number }> } {
    const basic = this.getStats();
    const byUrl: Record<string, { idle: number; active: number }> = {};

    for (const [url, pool] of this.pools) {
      byUrl[url] = { idle: pool.length, active: 0 };
    }

    for (const pooled of this.activeConnections.values()) {
      if (!byUrl[pooled.url]) {
        byUrl[pooled.url] = { idle: 0, active: 0 };
      }
      byUrl[pooled.url].active++;
    }

    return { ...basic, byUrl };
  }

  /**
   * Close all connections and shut down the pool.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop background tasks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    // Reject all waiting requests
    for (const waiting of this.waitingRequests) {
      clearTimeout(waiting.timeoutId);
      waiting.reject(new Error('Pool is shutting down'));
    }
    this.waitingRequests = [];

    // Close all connections
    const closePromises: Promise<void>[] = [];

    for (const pool of this.pools.values()) {
      for (const pooled of pool) {
        closePromises.push(this.destroyConnection(pooled));
      }
    }
    this.pools.clear();

    for (const pooled of this.activeConnections.values()) {
      closePromises.push(this.destroyConnection(pooled));
    }
    this.activeConnections.clear();

    await Promise.all(closePromises);
  }

  /**
   * Remove all connections for a specific URL.
   */
  async removeUrl(url: string): Promise<void> {
    const pool = this.pools.get(url);
    if (pool) {
      for (const pooled of pool) {
        await this.destroyConnection(pooled);
      }
      this.pools.delete(url);
    }

    // Also close active connections for this URL
    for (const [id, pooled] of this.activeConnections) {
      if (pooled.url === url) {
        await this.destroyConnection(pooled);
        this.activeConnections.delete(id);
      }
    }
  }

  private getPool(url: string): PooledConnection[] {
    let pool = this.pools.get(url);
    if (!pool) {
      pool = [];
      this.pools.set(url, pool);
    }
    return pool;
  }

  private async getIdleConnection(url: string): Promise<McpConnection | null> {
    const pool = this.getPool(url);

    while (pool.length > 0) {
      const pooled = pool.shift()!;

      // Check age
      if (Date.now() - pooled.createdAt > this.options.maxConnectionAgeMs) {
        this.destroyConnection(pooled);
        continue;
      }

      // Validate if enabled
      if (this.options.validateOnAcquire) {
        try {
          const isHealthy = await pooled.connection.ping();
          if (!isHealthy) {
            pooled.isHealthy = false;
            this.destroyConnection(pooled);
            continue;
          }
        } catch {
          pooled.isHealthy = false;
          this.destroyConnection(pooled);
          continue;
        }
      }

      // Connection is good
      pooled.useCount++;
      pooled.lastUsedAt = Date.now();
      this.activeConnections.set(pooled.connection.id, pooled);
      return pooled.connection;
    }

    return null;
  }

  private async tryCreateConnection(options: ConnectionOptions): Promise<McpConnection | null> {
    const { url } = options;
    const pool = this.getPool(url);

    // Check per-URL limit
    const urlCount = pool.length + [...this.activeConnections.values()].filter((p) => p.url === url).length;
    if (urlCount >= this.options.maxConnections) {
      return null;
    }

    // Check total limit
    const totalCount = this.getTotalConnectionCount();
    if (totalCount >= this.options.maxTotalConnections) {
      return null;
    }

    const pooled = await this.createConnection(options);
    this.activeConnections.set(pooled.connection.id, pooled);
    return pooled.connection;
  }

  private async createConnection(options: ConnectionOptions): Promise<PooledConnection> {
    const connection = await this.options.factory(options);
    const now = Date.now();

    const pooled: PooledConnection = {
      connection,
      url: options.url,
      createdAt: now,
      lastUsedAt: now,
      useCount: 1,
      isHealthy: true,
    };

    this.stats.totalCreated++;
    this.options.onCreate?.(connection);

    return pooled;
  }

  private async destroyConnection(pooled: PooledConnection): Promise<void> {
    try {
      await pooled.connection.close();
    } catch (err) {
      this.options.onError?.(err as Error, pooled.connection);
    }

    this.stats.totalDestroyed++;
    this.options.onDestroy?.(pooled.connection);
  }

  private waitForConnection(url: string): Promise<McpConnection> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitingRequests.findIndex(
          (r) => r.resolve === resolve
        );
        if (index >= 0) {
          this.waitingRequests.splice(index, 1);
        }
        this.stats.acquireTimeouts++;
        reject(new Error(`Timeout waiting for connection to ${url}`));
      }, this.options.acquireTimeoutMs);

      this.waitingRequests.push({
        url,
        resolve,
        reject,
        timeoutId,
        timestamp: Date.now(),
      });
    });
  }

  private getTotalConnectionCount(): number {
    let total = this.activeConnections.size;
    for (const pool of this.pools.values()) {
      total += pool.length;
    }
    return total;
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      for (const [url, pool] of this.pools) {
        const toRemove: number[] = [];

        for (let i = 0; i < pool.length; i++) {
          const pooled = pool[i];
          try {
            const isHealthy = await pooled.connection.ping();
            pooled.isHealthy = isHealthy;
            if (!isHealthy) {
              toRemove.push(i);
            }
          } catch {
            pooled.isHealthy = false;
            toRemove.push(i);
            this.stats.healthCheckFailures++;
          }
        }

        // Remove unhealthy connections (in reverse order to preserve indices)
        for (let i = toRemove.length - 1; i >= 0; i--) {
          const pooled = pool.splice(toRemove[i], 1)[0];
          this.destroyConnection(pooled);
        }

        // Ensure minimum connections
        const needed = this.options.minConnections - pool.length;
        for (let i = 0; i < needed; i++) {
          try {
            const newPooled = await this.createConnection({ url });
            pool.push(newPooled);
          } catch (err) {
            this.options.onError?.(err as Error);
          }
        }
      }
    }, this.options.healthCheckIntervalMs);
  }

  private startIdleCheck(): void {
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now();

      for (const [url, pool] of this.pools) {
        const toRemove: number[] = [];

        for (let i = 0; i < pool.length; i++) {
          const pooled = pool[i];

          // Keep minimum connections
          if (pool.length - toRemove.length <= this.options.minConnections) {
            break;
          }

          // Check idle timeout
          if (now - pooled.lastUsedAt > this.options.idleTimeoutMs) {
            toRemove.push(i);
          }
        }

        // Remove idle connections (in reverse order)
        for (let i = toRemove.length - 1; i >= 0; i--) {
          const pooled = pool.splice(toRemove[i], 1)[0];
          this.destroyConnection(pooled);
        }
      }
    }, this.options.idleTimeoutMs / 2);
  }
}

/**
 * Helper to wrap any MCP client into a McpConnection interface.
 *
 * @example
 * ```typescript
 * const connection = wrapMcpClient(mcpClient, 'conn-1');
 * ```
 */
export function wrapMcpClient(
  client: {
    callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
    listTools(): Promise<ToolDefinition[]>;
    listResources?(): Promise<ResourceDefinition[]>;
    listPrompts?(): Promise<PromptDefinition[]>;
    ping?(): Promise<void>;
    disconnect?(): Promise<void>;
  },
  id?: string
): McpConnection {
  const now = Date.now();
  const connId = id ?? `conn-${now}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    id: connId,
    inUse: false,
    createdAt: now,
    lastUsedAt: now,

    async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
      this.lastUsedAt = Date.now();
      return client.callTool(name, args);
    },

    async listTools(): Promise<ToolDefinition[]> {
      this.lastUsedAt = Date.now();
      return client.listTools();
    },

    async listResources(): Promise<ResourceDefinition[]> {
      this.lastUsedAt = Date.now();
      return client.listResources?.() ?? [];
    },

    async listPrompts(): Promise<PromptDefinition[]> {
      this.lastUsedAt = Date.now();
      return client.listPrompts?.() ?? [];
    },

    async ping(): Promise<boolean> {
      try {
        if (client.ping) {
          await client.ping();
        }
        return true;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      await client.disconnect?.();
    },
  };
}

/**
 * Create a simple round-robin load balancer for multiple URLs.
 *
 * @example
 * ```typescript
 * const balancer = createLoadBalancer(['http://server1:50051', 'http://server2:50051']);
 *
 * // Round-robin through servers
 * const url1 = balancer.next(); // server1
 * const url2 = balancer.next(); // server2
 * const url3 = balancer.next(); // server1
 * ```
 */
export function createLoadBalancer(urls: string[]): {
  next(): string;
  remove(url: string): void;
  add(url: string): void;
  getUrls(): string[];
} {
  let index = 0;
  const activeUrls = [...urls];

  return {
    next(): string {
      if (activeUrls.length === 0) {
        throw new Error('No URLs available');
      }
      const url = activeUrls[index % activeUrls.length];
      index++;
      return url;
    },

    remove(url: string): void {
      const i = activeUrls.indexOf(url);
      if (i >= 0) {
        activeUrls.splice(i, 1);
      }
    },

    add(url: string): void {
      if (!activeUrls.includes(url)) {
        activeUrls.push(url);
      }
    },

    getUrls(): string[] {
      return [...activeUrls];
    },
  };
}
