export interface RoomEntryCue {
  buffer: AudioBuffer;
}

type RoomFeedbackCue = "enter-room" | "member-join";
const cached = new Map<string, Promise<RoomEntryCue>>();

/** One short-lived worker per cue/rate; warmup and playback share immutable samples. */
const loadCue = (context: AudioContext, cue: RoomFeedbackCue): Promise<RoomEntryCue> => {
  const key = `${cue}:${context.sampleRate}`;
  const existing = cached.get(key);
  if (existing) return existing;
  const loading = new Promise<RoomEntryCue>((resolve, reject) => {
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
      try {
        const { left, right } = event.data;
        if (
          !(left instanceof Float32Array) ||
          !(right instanceof Float32Array) ||
          left.length === 0 ||
          left.length !== right.length ||
          left.length > context.sampleRate * 2
        )
          throw new Error("room_feedback_cue_invalid");
        const buffer = context.createBuffer(2, left.length, context.sampleRate);
        buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
        buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
        resolve({ buffer });
      } catch (error) {
        reject(error);
      }
    };
    try {
      worker.postMessage({ sampleRate: context.sampleRate, cue });
    } catch (error) {
      finish();
      reject(error);
    }
  }).catch((error) => {
    cached.delete(key);
    throw error;
  });
  cached.set(key, loading);
  return loading;
};

export const loadRoomEntryCue = (context: AudioContext): Promise<RoomEntryCue> =>
  loadCue(context, "enter-room");

export const loadRoomMemberJoinCue = (context: AudioContext): Promise<RoomEntryCue> =>
  loadCue(context, "member-join");
