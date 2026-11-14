/**
 * In-memory per-Lambda-container cache. Warm invocations skip DynamoDB reads
 * until TTL elapses. There is no cross-container invalidation (no Redis).
 * Max staleness is SETTINGS_CACHE_TTL_SECONDS (default 60s) after a dashboard
 * or admin write. Writes in the same container also drop matching keys.
 */
export class TtlCache {
  private readonly items = new Map<string, { expiresAtMs: number; value: unknown }>();

  constructor(public readonly ttlMs: number) {}

  async getOrLoad<T>(key: string, nowMs: number, load: () => Promise<T>): Promise<T> {
    if (this.ttlMs <= 0) {
      return load();
    }
    const hit = this.items.get(key);
    if (hit && hit.expiresAtMs > nowMs) {
      return hit.value as T;
    }
    const value = await load();
    this.items.set(key, { value, expiresAtMs: nowMs + this.ttlMs });
    return value;
  }

  hasFresh(key: string, nowMs: number): boolean {
    if (this.ttlMs <= 0) return false;
    const hit = this.items.get(key);
    return Boolean(hit && hit.expiresAtMs > nowMs);
  }

  invalidate(key: string): void {
    this.items.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.items.keys()) {
      if (key.startsWith(prefix)) {
        this.items.delete(key);
      }
    }
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}
