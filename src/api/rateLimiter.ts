export class RateLimiter {
  private queue: Array<() => void> = [];
  private nextAvailable = 0;
  private readonly intervalMs: number;

  constructor(requestsPerSecond: number) {
    this.intervalMs = Math.ceil(1000 / Math.max(1, requestsPerSecond));
  }

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      if (this.queue.length === 1) this.drain();
    });
    return fn();
  }

  private drain(): void {
    const next = this.queue[0];
    if (!next) return;
    const delay = Math.max(0, this.nextAvailable - Date.now());
    setTimeout(() => {
      this.queue.shift();
      this.nextAvailable = Date.now() + this.intervalMs;
      next();
      this.drain();
    }, delay);
  }
}
