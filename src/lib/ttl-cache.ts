/*
 * Copyright (c) 2010-2026 Contributors to the openHAB project
 *
 * See the NOTICE file(s) distributed with this work for additional
 * information.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0
 *
 * SPDX-License-Identifier: EPL-2.0
 */

/**
 * TTL Cache
 *
 * Bounded in-memory cache with per-entry expiry, used to keep repeated
 * lookups off the database on hot request paths.
 *
 * Entries expire on read, and a periodic sweep drops expired entries that are
 * never read again. When the cache is full the oldest entry is evicted, which
 * bounds memory on an instance serving many users.
 *
 * getOrLoad() collapses concurrent misses for the same key onto a single
 * load, which matters here because HTTP/2 delivers a page's requests as one
 * burst - without it a cold cache would issue one query per request.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  /** Loads in flight, so concurrent misses share one call */
  private readonly pending = new Map<string, Promise<V | null>>();

  /**
   * Bumped by delete()/clear(). A load that started before an invalidation
   * must not write its now-stale result back into the cache.
   */
  private generation = 0;

  /**
   * @param ttlMs - How long an entry stays valid
   * @param maxEntries - Upper bound on cached entries
   * @param sweepIntervalMs - How often to drop expired entries
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10000,
    sweepIntervalMs = 60 * 1000
  ) {
    // unref() so an idle sweep timer never keeps the process alive
    const timer = setInterval(() => this.sweep(), sweepIntervalMs);
    timer.unref();
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    // Re-inserting moves the key to the end, keeping insertion order accurate
    // for eviction.
    this.entries.delete(key);

    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }

    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Return the cached value, or run loader() and cache a non-null result.
   *
   * Concurrent callers for the same key share one loader call. A null result
   * means "not found" and is deliberately not cached.
   */
  getOrLoad(key: string, loader: () => Promise<V | null>): Promise<V | null> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const generation = this.generation;
    const load = loader().then(
      (value) => {
        this.pending.delete(key);
        // Drop the result if it was invalidated while we were loading
        if (value !== null && value !== undefined && this.generation === generation) {
          this.set(key, value);
        }
        return value;
      },
      (error: unknown) => {
        this.pending.delete(key);
        throw error;
      }
    );

    this.pending.set(key, load);
    return load;
  }

  delete(key: string): void {
    this.entries.delete(key);
    this.pending.delete(key);
    this.generation++;
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.generation++;
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }
}
