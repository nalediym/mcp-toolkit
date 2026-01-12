/**
 * Tool Definition Cacher
 *
 * Caches tool, resource, and prompt schemas to avoid repeated fetches.
 * Supports TTL-based expiration and manual invalidation.
 *
 * Features:
 * - In-memory caching with configurable TTL
 * - Optional persistent storage adapter
 * - Automatic background refresh
 * - Statistics tracking
 * - Stale-while-revalidate pattern support
 *
 * @example
 * ```typescript
 * const cacher = new ToolDefinitionCacher({
 *   ttlMs: 60000, // 1 minute
 *   fetchTools: () => mcpClient.listTools(),
 *   fetchResources: () => mcpClient.listResources(),
 *   fetchPrompts: () => mcpClient.listPrompts(),
 * });
 *
 * // First call fetches from server
 * const tools1 = await cacher.getTools();
 *
 * // Second call returns cached result
 * const tools2 = await cacher.getTools();
 *
 * // Force refresh
 * const tools3 = await cacher.getTools({ forceRefresh: true });
 * ```
 */

import type {
  ToolDefinition,
  ResourceDefinition,
  PromptDefinition,
  CacheStats,
} from './types.js';

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  size: number;
}

/**
 * Storage adapter interface for persistent caching
 */
export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Options for fetching cached data
 */
export interface FetchOptions {
  /** Force a fresh fetch, ignoring cache */
  forceRefresh?: boolean;
  /** Allow returning stale data while refreshing in background */
  staleWhileRevalidate?: boolean;
}

/**
 * Options for the cacher
 */
export interface CacherOptions {
  /** Time-to-live for cached entries in milliseconds. Default: 300000 (5 minutes) */
  ttlMs?: number;

  /** Function to fetch tool definitions */
  fetchTools?: () => Promise<ToolDefinition[]>;

  /** Function to fetch resource definitions */
  fetchResources?: () => Promise<ResourceDefinition[]>;

  /** Function to fetch prompt definitions */
  fetchPrompts?: () => Promise<PromptDefinition[]>;

  /** Optional storage adapter for persistence */
  storage?: StorageAdapter;

  /** Whether to automatically refresh before expiry. Default: false */
  autoRefresh?: boolean;

  /** How long before expiry to trigger auto-refresh (ms). Default: 30000 */
  autoRefreshBeforeExpiryMs?: number;

  /** Callback when cache is updated */
  onUpdate?: (type: 'tools' | 'resources' | 'prompts') => void;
}

const CACHE_KEYS = {
  tools: 'mcp:tools',
  resources: 'mcp:resources',
  prompts: 'mcp:prompts',
} as const;

/**
 * Tool Definition Cacher
 *
 * Caches MCP schema definitions to reduce server round-trips.
 */
export class ToolDefinitionCacher {
  private cache = new Map<string, CacheEntry<unknown>>();
  private options: Required<Omit<CacherOptions, 'storage' | 'fetchTools' | 'fetchResources' | 'fetchPrompts' | 'onUpdate'>> & Omit<CacherOptions, 'ttlMs' | 'autoRefresh' | 'autoRefreshBeforeExpiryMs'>;
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingFetches = new Map<string, Promise<unknown>>();
  private stats = {
    hits: 0,
    misses: 0,
  };

  constructor(options: CacherOptions = {}) {
    this.options = {
      ttlMs: options.ttlMs ?? 300000, // 5 minutes default
      autoRefresh: options.autoRefresh ?? false,
      autoRefreshBeforeExpiryMs: options.autoRefreshBeforeExpiryMs ?? 30000,
      fetchTools: options.fetchTools,
      fetchResources: options.fetchResources,
      fetchPrompts: options.fetchPrompts,
      storage: options.storage,
      onUpdate: options.onUpdate,
    };
  }

  /**
   * Get cached tool definitions.
   */
  async getTools(options: FetchOptions = {}): Promise<ToolDefinition[]> {
    if (!this.options.fetchTools) {
      throw new Error('fetchTools function not configured');
    }
    return this.getCached(
      CACHE_KEYS.tools,
      this.options.fetchTools,
      options
    ) as Promise<ToolDefinition[]>;
  }

  /**
   * Get cached resource definitions.
   */
  async getResources(options: FetchOptions = {}): Promise<ResourceDefinition[]> {
    if (!this.options.fetchResources) {
      throw new Error('fetchResources function not configured');
    }
    return this.getCached(
      CACHE_KEYS.resources,
      this.options.fetchResources,
      options
    ) as Promise<ResourceDefinition[]>;
  }

  /**
   * Get cached prompt definitions.
   */
  async getPrompts(options: FetchOptions = {}): Promise<PromptDefinition[]> {
    if (!this.options.fetchPrompts) {
      throw new Error('fetchPrompts function not configured');
    }
    return this.getCached(
      CACHE_KEYS.prompts,
      this.options.fetchPrompts,
      options
    ) as Promise<PromptDefinition[]>;
  }

  /**
   * Get a specific tool definition by name.
   */
  async getTool(name: string, options: FetchOptions = {}): Promise<ToolDefinition | undefined> {
    const tools = await this.getTools(options);
    return tools.find((t) => t.name === name);
  }

  /**
   * Get a specific resource definition by URI.
   */
  async getResource(uri: string, options: FetchOptions = {}): Promise<ResourceDefinition | undefined> {
    const resources = await this.getResources(options);
    return resources.find((r) => r.uri === uri);
  }

  /**
   * Get a specific prompt definition by name.
   */
  async getPrompt(name: string, options: FetchOptions = {}): Promise<PromptDefinition | undefined> {
    const prompts = await this.getPrompts(options);
    return prompts.find((p) => p.name === name);
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(type: 'tools' | 'resources' | 'prompts'): void {
    const key = CACHE_KEYS[type];
    this.cache.delete(key);
    this.cancelRefresh(key);
    this.options.storage?.delete(key);
  }

  /**
   * Invalidate all cached entries.
   */
  invalidateAll(): void {
    this.cache.clear();
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.options.storage?.clear();
  }

  /**
   * Preload all caches.
   */
  async preload(): Promise<void> {
    const promises: Promise<unknown>[] = [];

    if (this.options.fetchTools) {
      promises.push(this.getTools());
    }
    if (this.options.fetchResources) {
      promises.push(this.getResources());
    }
    if (this.options.fetchPrompts) {
      promises.push(this.getPrompts());
    }

    await Promise.all(promises);
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    let bytesUsed = 0;
    for (const entry of this.cache.values()) {
      bytesUsed += entry.size;
    }

    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      entries: this.cache.size,
      bytesUsed,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Check if a cache entry is valid (exists and not expired).
   */
  isValid(type: 'tools' | 'resources' | 'prompts'): boolean {
    const entry = this.cache.get(CACHE_KEYS[type]);
    return entry !== undefined && Date.now() < entry.expiresAt;
  }

  /**
   * Get the expiry time for a cache entry.
   */
  getExpiry(type: 'tools' | 'resources' | 'prompts'): number | null {
    const entry = this.cache.get(CACHE_KEYS[type]);
    return entry?.expiresAt ?? null;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
    this.cache.clear();
  }

  private async getCached<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: FetchOptions
  ): Promise<T> {
    const now = Date.now();

    // Check memory cache
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;

    if (cached && !options.forceRefresh) {
      const isExpired = now >= cached.expiresAt;

      if (!isExpired) {
        this.stats.hits++;
        return cached.data;
      }

      // Expired but can use stale-while-revalidate
      if (options.staleWhileRevalidate) {
        this.stats.hits++;
        // Trigger background refresh
        this.refreshInBackground(key, fetchFn);
        return cached.data;
      }
    }

    // Check persistent storage
    if (!cached && this.options.storage) {
      const stored = await this.options.storage.get<CacheEntry<T>>(key);
      if (stored && now < stored.expiresAt) {
        this.cache.set(key, stored);
        this.stats.hits++;
        this.scheduleRefresh(key, fetchFn, stored.expiresAt);
        return stored.data;
      }
    }

    this.stats.misses++;

    // Deduplicate concurrent fetches
    let pending = this.pendingFetches.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = this.fetchAndCache(key, fetchFn);
      this.pendingFetches.set(key, pending);
    }

    try {
      return await pending;
    } finally {
      this.pendingFetches.delete(key);
    }
  }

  private async fetchAndCache<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    const data = await fetchFn();
    const now = Date.now();
    const expiresAt = now + this.options.ttlMs;

    // Estimate size (rough approximation)
    const size = JSON.stringify(data).length * 2; // UTF-16

    const entry: CacheEntry<T> = {
      data,
      fetchedAt: now,
      expiresAt,
      size,
    };

    this.cache.set(key, entry);

    // Persist if storage adapter is configured
    if (this.options.storage) {
      await this.options.storage.set(key, entry, this.options.ttlMs);
    }

    // Schedule auto-refresh if enabled
    this.scheduleRefresh(key, fetchFn, expiresAt);

    // Notify update
    const type = Object.entries(CACHE_KEYS).find(([, v]) => v === key)?.[0] as 'tools' | 'resources' | 'prompts' | undefined;
    if (type) {
      this.options.onUpdate?.(type);
    }

    return data;
  }

  private scheduleRefresh<T>(key: string, fetchFn: () => Promise<T>, expiresAt: number): void {
    if (!this.options.autoRefresh) {
      return;
    }

    this.cancelRefresh(key);

    const refreshAt = expiresAt - this.options.autoRefreshBeforeExpiryMs;
    const delay = Math.max(0, refreshAt - Date.now());

    if (delay > 0) {
      const timer = setTimeout(() => {
        this.refreshInBackground(key, fetchFn);
      }, delay);
      this.refreshTimers.set(key, timer);
    }
  }

  private cancelRefresh(key: string): void {
    const timer = this.refreshTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.refreshTimers.delete(key);
    }
  }

  private refreshInBackground<T>(key: string, fetchFn: () => Promise<T>): void {
    // Don't await - let it run in background
    this.fetchAndCache(key, fetchFn).catch((err) => {
      // Log but don't throw - background refresh failures are non-fatal
      console.warn(`Background refresh failed for ${key}:`, err);
    });
  }
}

/**
 * Simple in-memory storage adapter.
 * Useful for testing or when you just need a clean interface.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? Infinity),
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * Higher-order function that wraps list functions with caching.
 *
 * @example
 * ```typescript
 * const cachedListTools = withCaching(
 *   () => mcpClient.listTools(),
 *   { ttlMs: 60000 }
 * );
 *
 * const tools = await cachedListTools();
 * ```
 */
export function withCaching<T>(
  fetchFn: () => Promise<T>,
  options: { ttlMs?: number; key?: string } = {}
): () => Promise<T> {
  const ttlMs = options.ttlMs ?? 300000;
  const key = options.key ?? 'default';

  let cached: { data: T; expiresAt: number } | null = null;
  let pending: Promise<T> | null = null;

  return async () => {
    const now = Date.now();

    if (cached && now < cached.expiresAt) {
      return cached.data;
    }

    if (pending) {
      return pending;
    }

    pending = fetchFn().then((data) => {
      cached = { data, expiresAt: now + ttlMs };
      pending = null;
      return data;
    }).catch((err) => {
      pending = null;
      throw err;
    });

    return pending;
  };
}
