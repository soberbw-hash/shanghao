import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Borrows the library's existing player and owns only the preview boundary. */
export const useRecordingClipPreview = (
  audio: RefObject<HTMLAudioElement | null>,
  recordingId?: string,
) => {
  const preview = useRef<{ start: number; end: number } | undefined>(undefined);
  const wasPreview = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const removeBoundary = useRef<(() => void) | undefined>(undefined);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    preview.current = undefined;
    removeBoundary.current?.();
    removeBoundary.current = undefined;
  }, []);
  const reset = useCallback(() => {
    wasPreview.current = false;
    stop();
  }, [stop]);
  useEffect(() => {
    wasPreview.current = false;
    stop();
    return stop;
  }, [recordingId, stop]);
  const play = async (startMs: number, endMs: number) => {
    stop();
    const owner = generation.current;
    const player = audio.current;
    if (!player) throw new Error("clip_source_unreadable");
    preview.current = { start: startMs / 1_000, end: endMs / 1_000 };
    wasPreview.current = true;
    player.currentTime = startMs / 1_000;
    const tick = () => {
      const segment = preview.current;
      if (!segment || audio.current !== player || player.paused) return stop();
      if (player.currentTime >= segment.end) {
        player.pause();
        return stop();
      }
      if (player.currentTime < segment.start - 0.1) {
        wasPreview.current = false;
        return stop();
      }
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(
        tick,
        Math.max(10, Math.min(50, (segment.end - player.currentTime) * 1000)),
      );
    };
    player.addEventListener("timeupdate", tick);
    const hidden = () => {
      if (document.hidden) {
        player.pause();
        stop();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    removeBoundary.current = () => {
      player.removeEventListener("timeupdate", tick);
      document.removeEventListener("visibilitychange", hidden);
    };
    try {
      await player.play();
    } catch (error) {
      if (generation.current !== owner) return;
      stop();
      throw error;
    }
    if (generation.current !== owner) return;
    tick();
  };
  return { play, reset, wasPreview };
};
