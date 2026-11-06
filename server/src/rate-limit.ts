// In-memory sliding window per key. One server process, so memory is enough.
export class RateLimit {
  private hits = new Map<string, number[]>()

  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Records a hit. Returns false if the key has reached the limit. */
  take(key: string, now: number) {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs)
    if (recent.length >= this.max) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}
