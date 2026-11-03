import type { ProcessedMicrophoneStream } from "./microphoneProcessor";

/** A zero-valued track allows receive-only room entry without acquiring another device. */
export async function createListenOnlyMicrophone(): Promise<ProcessedMicrophoneStream> {
  const context = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
  const source = context.createConstantSource();
  const destination = context.createMediaStreamDestination();
  source.offset.value = 0;
  destination.channelCount = 1;
  source.connect(destination);
  source.start();
  for (const track of destination.stream.getTracks()) track.enabled = false;
  try {
    await context.resume();
  } catch (error) {
    source.stop();
    source.disconnect();
    destination.stream.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
    throw error;
  }
  let disposed = false;
  return {
    stream: destination.stream,
    processorDiagnostics: {},
    ready: Promise.resolve({}),
    onDiagnostics: () => () => undefined,
    setSendVolume: () => undefined,
    getSendVolume: () => 0,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      source.stop();
      source.disconnect();
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
}
