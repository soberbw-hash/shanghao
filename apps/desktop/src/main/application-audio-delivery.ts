/** Backpressure bounds queued Electron IPC even if the renderer is frozen. */
export class ApplicationAudioDelivery {
  private sessionId = "";
  private readonly pending = new Set<number>();
  offer(sessionId: string, sequence: number): boolean {
    if (sessionId !== this.sessionId) {
      this.pending.clear();
      this.sessionId = sessionId;
    }
    if (this.pending.size >= 8 || this.pending.has(sequence)) return false;
    this.pending.add(sequence);
    return true;
  }
  acknowledge(sessionId: string, sequence: number): void {
    if (sessionId === this.sessionId && Number.isSafeInteger(sequence))
      this.pending.delete(sequence);
  }
  clear(sessionId?: string): void {
    if (sessionId && sessionId !== this.sessionId) return;
    this.sessionId = "";
    this.pending.clear();
  }
}
