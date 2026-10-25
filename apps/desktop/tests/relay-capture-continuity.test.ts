import assert from "node:assert/strict";
import test from "node:test";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
test("high sample rates and batched callbacks preserve continuous voice instead of discarding PCM", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopApi: { app: { writeLog: async () => {} } } },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const { SignalingAudioRelay } =
    await import("../src/renderer/src/features/room/signalingAudioRelay");
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  for (const rate of [44100, 48000, 96000, 192000]) {
    const sent: number[] = [];
    const relay = new SignalingAudioRelay({
      roomId: "room",
      peerId: "local",
      localStream: { getAudioTracks: () => [{ readyState: "live", enabled: true }] },
      getTargetPeerIds: () => ["friend"],
      shouldPlayPeer: () => true,
      send: async (packet: { durationMs?: number }) => {
        if (packet.durationMs) sent.push(packet.durationMs);
      },
    } as never);
    relay.setShouldSend(true);
    const capture = relay as unknown as {
      sendCapturedAudio(input: Float32Array, sampleRate: number): void;
    };
    for (let frame = 0; frame < 12; frame++) {
      now += (1024 / rate) * 1000;
      capture.sendCapturedAudio(new Float32Array(1024).fill(0.15), rate);
      await settle();
    }
    assert.ok(
      Math.abs(sent.reduce((sum, duration) => sum + duration, 0) - ((12 * 1024) / rate) * 1000) <
        0.1,
      `${rate} Hz must not discard real audio to satisfy a wall-clock throttle`,
    );
    relay.destroy();
  }
  const sent: number[] = [];
  const relay = new SignalingAudioRelay({
    roomId: "room",
    peerId: "local",
    localStream: { getAudioTracks: () => [{ readyState: "live", enabled: true }] },
    getTargetPeerIds: () => ["friend"],
    shouldPlayPeer: () => true,
    send: async (packet: { durationMs?: number }) => {
      if (packet.durationMs) sent.push(packet.durationMs);
    },
  } as never);
  relay.setShouldSend(true);
  for (let frame = 0; frame < 4; frame++)
    (
      relay as unknown as { sendCapturedAudio(input: Float32Array, rate: number): void }
    ).sendCapturedAudio(new Float32Array(1024).fill(0.15), 48000);
  for (let i = 0; i < 10; i++) await settle();
  assert.ok(Math.abs(sent.reduce((sum, duration) => sum + duration, 0) - (4 * 1024) / 48) < 0.1);
  relay.destroy();
});
