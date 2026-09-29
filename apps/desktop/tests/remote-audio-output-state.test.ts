import assert from "node:assert/strict";
import test from "node:test";

test("speaker routing reports applied, fallback and unsupported separately from requested", async () => {
  Object.assign(globalThis, {
    window: { desktopApi: { app: { writeLog: async () => undefined } } },
  });
  const { RemoteAudioMixer } = await import("../src/renderer/src/features/audio/RemoteAudioMixer");
  const mixer = new RemoteAudioMixer();
  const routed: string[] = [];
  Object.assign(mixer, {
    context: {
      currentTime: 0,
      state: "running",
      setSinkId: async (sinkId: string) => {
        routed.push(sinkId);
        if (sinkId === "missing-speaker") throw new Error("speaker unavailable");
      },
    },
  });

  await mixer.setOutputDevice("usb-speaker");
  assert.equal(mixer.getDiagnostics().outputDeviceId, "usb-speaker");
  assert.equal(mixer.getDiagnostics().appliedOutputDeviceId, "usb-speaker");
  assert.equal(mixer.getDiagnostics().outputRouteStatus, "applied");

  await mixer.setOutputDevice("missing-speaker");
  assert.deepEqual(routed.slice(-2), ["missing-speaker", "default"]);
  assert.equal(mixer.getDiagnostics().outputDeviceId, "default");
  assert.equal(mixer.getDiagnostics().appliedOutputDeviceId, "default");
  assert.equal(mixer.getDiagnostics().outputRouteStatus, "fallback");

  Object.assign(mixer, { context: { currentTime: 0, state: "running" } });
  await mixer.setOutputDevice("unsupported-speaker");
  assert.equal(mixer.getDiagnostics().outputDeviceId, "unsupported-speaker");
  assert.equal(mixer.getDiagnostics().appliedOutputDeviceId, "default");
  assert.equal(mixer.getDiagnostics().outputRouteStatus, "unsupported");
});
