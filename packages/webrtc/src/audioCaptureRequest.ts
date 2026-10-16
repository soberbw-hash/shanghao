// getUserMedia cannot be aborted. Keep ownership of a timed-out native request
// until it settles, so retries cannot stack driver opens or leak a late stream.
let pendingCapture: Promise<MediaStream> | undefined;
const CAPTURE_TIMEOUT_MS = 15_000;

export const requestAudioCapture = (constraints: MediaStreamConstraints): Promise<MediaStream> => {
  if (pendingCapture) {
    return Promise.reject(
      new DOMException("Previous microphone request is still pending", "AudioCaptureTimeoutError"),
    );
  }

  const request = navigator.mediaDevices.getUserMedia(constraints);
  pendingCapture = request;
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new DOMException("Microphone did not respond in time", "AudioCaptureTimeoutError"));
    }, CAPTURE_TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timer);
      if (pendingCapture === request) pendingCapture = undefined;
    };
    void request.then(
      (stream) => {
        finish();
        if (expired) stream.getTracks().forEach((track) => track.stop());
        else resolve(stream);
      },
      (error: unknown) => {
        finish();
        if (!expired) reject(error);
      },
    );
  });
};
