interface Entry {
  value: string;
  expiresAt: number;
}

export class ShortCache {
  private entries = new Map<string, Entry>();
  private maxEntries: number;

  constructor(maxEntries = 300) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: string, now = Date.now()): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= now) {
      this.entries.delete(key);

      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: string, ttlMs: number, now = Date.now()): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed++;
      }
    }

    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}
