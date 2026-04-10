export class ExponentialBackoff {
  private attempt = 0;

  constructor(private readonly delaysMs: number[]) {}

  reset(): void {
    this.attempt = 0;
  }

  nextDelay(): number {
    const index = Math.min(this.attempt, this.delaysMs.length - 1);
    const delay = this.delaysMs[index] ?? this.delaysMs[this.delaysMs.length - 1] ?? 1000;
    this.attempt += 1;
    return delay;
  }
}
