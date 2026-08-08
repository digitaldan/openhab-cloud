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
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

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

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
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
