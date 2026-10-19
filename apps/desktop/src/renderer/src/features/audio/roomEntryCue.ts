export interface RoomEntryCue {
  buffer: AudioBuffer;
}

let cached: Promise<RoomEntryCue> | undefined;

/** One short-lived worker and one immutable buffer, shared by warmup and entry. */
export const loadRoomEntryCue = (context: AudioContext): Promise<RoomEntryCue> => {
  if (cached) return cached;
  cached = new Promise<RoomEntryCue>((resolve, reject) => {
    const worker = new Worker(new URL("./roomEntryCue.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error("room_entry_cue_timeout"));
    }, 2_000);
    worker.onerror = () => {
      finish();
      reject(new Error("room_entry_cue_unavailable"));
    };
    worker.onmessage = (event: MessageEvent<{ left: Float32Array; right: Float32Array }>) => {
      finish();
      const { left, right } = event.data;
      const buffer = context.createBuffer(2, left.length, context.sampleRate);
      buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
      buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
      resolve({ buffer });
    };
    worker.postMessage({ sampleRate: context.sampleRate });
  }).catch((error) => {
    cached = undefined;
    throw error;
  });
  return cached;
};
