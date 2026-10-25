import { SignalingAudioRelay } from "../../src/renderer/src/features/room/signalingAudioRelay";

declare global {
  interface Window {
    testRelayContinuity(): Promise<Record<string, unknown>>;
  }
}
window.testRelayContinuity = async () => {
  const OriginalContext = window.AudioContext;
  const contexts: AudioContext[] = [];
  window.AudioContext = class extends OriginalContext {
    constructor(options?: AudioContextOptions) {
      super({ ...options, sampleRate: 96000 });
      contexts.push(this);
    }
  };
  const source = new AudioContext();
  const oscillator = source.createOscillator(),
    destination = source.createMediaStreamDestination();
  oscillator.frequency.value = 440;
  oscillator.connect(destination); // Never connect the tone to the device speakers.
  let sentAudioMs = 0,
    packets = 0;
  const relay = new SignalingAudioRelay({
    roomId: "isolated",
    peerId: "tone",
    localStream: destination.stream,
    getTargetPeerIds: () => ["in-memory-only"],
    shouldPlayPeer: () => false,
    send: async (packet) => {
      if (packet.type === "audio_chunk") {
        sentAudioMs += packet.durationMs ?? 0;
        packets++;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  });
  let pressure: number | undefined;
  try {
    relay.setShouldSend(true);
    await relay.start();
    await source.resume();
    oscillator.start();
    const started = performance.now();
    pressure = window.setInterval(() => {
      const until = performance.now() + 40;
      while (performance.now() < until) {
        /* simulate a busy game overlay renderer */
      }
    }, 200);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const elapsedMs = performance.now() - started;
    return {
      sampleRates: contexts.map((context) => context.sampleRate),
      sentAudioMs,
      elapsedMs,
      packets,
      coverage: sentAudioMs / elapsedMs,
      microphoneUsed: false,
      audioUploaded: false,
    };
  } finally {
    if (pressure !== undefined) window.clearInterval(pressure);
    relay.destroy();
    oscillator.stop();
    destination.stream.getTracks().forEach((track) => track.stop());
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    window.AudioContext = OriginalContext;
  }
};
