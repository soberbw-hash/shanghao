import { createHash } from "node:crypto";
import { isPrivateRoomId } from "@private-voice/shared";
import { isSignalEnvelope, type PublishRecordingRecapMessage } from "./protocol";
import { VersionedJsonStore } from "./versioned-json-store";

interface Job {
  key: string;
  message: PublishRecordingRecapMessage;
  attempts: number;
  retryAt: number;
}
interface Jobs {
  version: 1;
  pending: Job[];
}
const validate = (value: unknown): Jobs => {
  const data = value as Jobs;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.pending) ||
    data.pending.length > 32 ||
    new Set(data.pending.map((job) => job?.key)).size !== data.pending.length ||
    data.pending.some(
      (job) =>
        !job ||
        typeof job.key !== "string" ||
        job.key.length > 256 ||
        !Number.isSafeInteger(job.attempts) ||
        job.attempts < 0 ||
        !Number.isFinite(job.retryAt) ||
        !isSignalEnvelope(job.message) ||
        job.message.type !== "publish_recording_recap" ||
        !isPrivateRoomId(job.message.roomId),
    )
  )
    throw new Error("room_memory_jobs_unreadable");
  return data;
};

/** Only explicitly uploaded recaps enter this durable, room-scoped queue. */
export class RoomMemoryJobs {
  private readonly store: Promise<VersionedJsonStore<Jobs>>;
  private readonly active = new Map<
    string,
    { roomId: string; controller: AbortController; done: Promise<void> }
  >();
  private closed = false;
  private pumping = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    file: string | undefined,
    private readonly execute: (
      message: PublishRecordingRecapMessage,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {
    this.store = VersionedJsonStore.open(file, { version: 1 as const, pending: [] }, validate);
    void this.store.then(() => this.pump()).catch(() => undefined);
  }
  async enqueue(message: PublishRecordingRecapMessage): Promise<void> {
    if (this.closed) throw new Error("room_memory_jobs_closed");
    const digest = createHash("sha256").update(JSON.stringify(message.recap)).digest("hex");
    const key = `${message.roomId}|${message.recap.recordingId}|${digest}`;
    const store = await this.store;
    if (this.closed) throw new Error("room_memory_jobs_closed");
    await store.transact((data) => {
      if (data.pending.some((job) => job.key === key)) return;
      if (data.pending.length >= 32) throw new Error("room_memory_jobs_full");
      data.pending.push({ key, message: structuredClone(message), attempts: 0, retryAt: 0 });
    });
    void this.pump();
  }
  private async pump(): Promise<void> {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    try {
      const store = await this.store;
      if (this.timer) clearTimeout(this.timer);
      while (!this.closed && this.active.size < 2) {
        const job = store
          .snapshot()
          .pending.find(
            (item) =>
              item.retryAt <= Date.now() &&
              !this.active.has(item.key) &&
              ![...this.active.values()].some((run) => run.roomId === item.message.roomId),
          );
        if (!job) break;
        const controller = new AbortController();
        const done = Promise.resolve()
          .then(() => this.execute(job.message, controller.signal))
          .then(async () => {
            if (!this.closed && !controller.signal.aborted)
              await store.transact((data) => {
                data.pending = data.pending.filter((item) => item.key !== job.key);
              });
          })
          .catch(async () => {
            if (this.closed) return;
            await store.transact((data) => {
              const pending = data.pending.find((item) => item.key === job.key);
              if (pending) {
                pending.attempts = Math.min(pending.attempts + 1, 1000);
                pending.retryAt =
                  Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(pending.attempts, 6));
              }
            });
          })
          .catch(() => undefined)
          .finally(() => {
            this.active.delete(job.key);
            void this.pump();
          });
        this.active.set(job.key, { roomId: job.message.roomId, controller, done });
      }
      if (!this.closed && store.snapshot().pending.length)
        this.timer = setTimeout(() => void this.pump(), 2000);
    } catch {
      if (!this.closed) this.timer = setTimeout(() => void this.pump(), 60_000);
    } finally {
      this.pumping = false;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const run of this.active.values()) run.controller.abort();
    await Promise.allSettled([...this.active.values()].map((run) => run.done));
    await this.store.then((store) => store.flush()).catch(() => undefined);
  }
}
