export type PromiseLruCacheOptions = {
  readonly maxEntries: number
  readonly now: () => number
  readonly ttlMilliseconds: number
}

type CacheEntry<V> = {
  readonly promise: Promise<V>
  expiresAt: number | null
}

export class PromiseLruCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>()

  constructor(private readonly options: PromiseLruCacheOptions) {}

  getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
    const current = this.entries.get(key)
    if (current !== undefined) {
      if (current.expiresAt === null || this.options.now() < current.expiresAt) {
        this.touch(key, current)
        return current.promise
      }
      this.entries.delete(key)
    }

    const promise = Promise.resolve().then(loader)
    const entry: CacheEntry<V> = { expiresAt: null, promise }
    this.entries.set(key, entry)
    this.evictOldest()
    void promise.then(
      () => {
        const current = this.entries.get(key)
        if (current !== undefined && current.promise === promise) {
          current.expiresAt = this.options.now() + this.options.ttlMilliseconds
        }
      },
      () => {
        const current = this.entries.get(key)
        if (current !== undefined && current.promise === promise) this.entries.delete(key)
      },
    )
    return promise
  }

  private touch(key: K, entry: CacheEntry<V>): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }

  private evictOldest(): void {
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) return
      this.entries.delete(oldest.value)
    }
  }
}
