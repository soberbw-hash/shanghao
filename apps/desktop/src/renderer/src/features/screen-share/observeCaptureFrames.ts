interface FrameReader {
  read(): Promise<{ done: boolean; value?: { close(): void } }>;
  cancel(): Promise<void>;
}
type TrackProcessor = new (options: { track: MediaStreamTrack; maxBufferSize: number }) => {
  readable: { getReader(): FrameReader };
};

/** Only decoded capture frames refresh input liveness. A timer cannot prove a video is flowing. */
export function observeCaptureFrames(stream: MediaStream): () => void {
  const api = window.desktopApi.remoteControl;
  if (!api) return () => {};
  let stopped = false;
  let reader: FrameReader | undefined;
  let video: HTMLVideoElement | undefined;
  let frameId: number | undefined;
  let cleanupBinding: (() => void) | undefined;
  let ownedTrack: MediaStreamTrack | undefined;
  let lastSent = -Infinity;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    void reader?.cancel().catch(() => undefined);
    ownedTrack?.stop();
    if (video) {
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      video.pause();
      video.srcObject = null;
    }
    cleanupBinding?.();
  };
  void api
    .getCapture()
    .then(async (capture) => {
      if (!capture) return;
      cleanupBinding = () => {
        void api.endCapture(capture.captureHandle).catch(() => undefined);
      };
      if (stopped) {
        cleanupBinding();
        return;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stop();
        return;
      }
      track.addEventListener("ended", stop, { once: true });
      const mark = () => {
        const now = performance.now();
        if (!stopped && now - lastSent >= 100) {
          lastSent = now;
          api.captureFrame(capture.captureHandle, capture.geometryVersion);
        }
      };
      const Processor = (
        globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessor }
      ).MediaStreamTrackProcessor;
      if (Processor) {
        ownedTrack = track.clone();
        reader = new Processor({ track: ownedTrack, maxBufferSize: 1 }).readable.getReader();
        while (!stopped) {
          const frame = await reader.read();
          if (frame.done) break;
          frame.value?.close();
          mark();
        }
        stop();
      } else {
        video = document.createElement("video");
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        const next = () => {
          if (!stopped) {
            mark();
            frameId = video!.requestVideoFrameCallback(next);
          }
        };
        frameId = video.requestVideoFrameCallback(next);
      }
    })
    .catch(stop);
  return stop;
}
