import { writeRendererLog } from "../../utils/logger";

export class PeerOperationQueue {
  private readonly queues = new Map<string, Promise<void>>();

  clear(): void {
    this.queues.clear();
  }

  enqueue(peerId: string, operationName: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(peerId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(peerId, current);
    void current
      .finally(() => {
        if (this.queues.get(peerId) === current) this.queues.delete(peerId);
      })
      .catch(() => undefined);
    return current.catch((error) => {
      void writeRendererLog("webrtc", "warn", "Serialized peer operation failed", {
        peerId,
        operationName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });
  }
}
