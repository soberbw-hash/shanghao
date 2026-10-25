import assert from "node:assert/strict";
import test from "node:test";
import { AudioDeviceState, MicPermissionState, RoomConnectionState } from "@private-voice/shared";
import { getMicrophoneStatus } from "../src/renderer/src/features/audio/microphoneStatus";

const connected = {
  isMuted: false,
  pushToTalkWaiting: false,
  permission: MicPermissionState.Granted,
  inputState: AudioDeviceState.Ready,
  connection: RoomConnectionState.Connected,
  tracks: [{ readyState: "live" as const, enabled: true, muted: false }],
  inputLost: false,
};

test("silence and a live output never establish remote audibility", () => {
  const status = getMicrophoneStatus(connected);
  assert.equal(status.capture, "active");
  assert.equal(status.tone, "neutral");
  assert.match(status.detail, /本机/);
  assert.match(status.detail, /不代表.*听到/);
});

test("intentional mute and push-to-talk pause are not device failures", () => {
  for (const tracks of [
    connected.tracks,
    [{ readyState: "live" as const, enabled: false, muted: false }],
  ]) {
    assert.equal(getMicrophoneStatus({ ...connected, tracks, isMuted: true }).capture, "muted");
    const waiting = getMicrophoneStatus({ ...connected, tracks, pushToTalkWaiting: true });
    assert.equal(waiting.capture, "push-to-talk");
    assert.equal(waiting.tone, "neutral");
  }
  const paused = getMicrophoneStatus({
    ...connected,
    tracks: [{ ...connected.tracks[0], enabled: false }],
  });
  assert.equal(paused.capture, "paused");
  assert.equal(paused.tone, "neutral");
});

test("transport recovery remains separate from capture failure", () => {
  for (const connection of [
    RoomConnectionState.Reconnecting,
    RoomConnectionState.Failed,
    RoomConnectionState.Disconnected,
  ]) {
    const status = getMicrophoneStatus({ ...connected, connection });
    assert.equal(status.capture, "active");
    assert.equal(status.tone, "warning");
    assert.match(status.detail, /连接/);
    assert.doesNotMatch(status.detail, /设备故障|设备被占用/);
  }
  const fallback = getMicrophoneStatus({ ...connected, connection: RoomConnectionState.Degraded });
  assert.equal(fallback.capture, "active");
  assert.match(fallback.detail, /备用/);
});

test("an ended or lost raw input warns even when processor output stays live", () => {
  assert.equal(getMicrophoneStatus({ ...connected, inputLost: true }).capture, "interrupted");
  assert.equal(
    getMicrophoneStatus({ ...connected, tracks: [{ ...connected.tracks[0], readyState: "ended" }] })
      .capture,
    "interrupted",
  );
  const mutedTrack = getMicrophoneStatus({
    ...connected,
    tracks: [{ ...connected.tracks[0], muted: true }],
  });
  assert.equal(mutedTrack.capture, "interrupted");
  assert.doesNotMatch(mutedTrack.detail, /设备被占用/);
});

test("missing capture distinguishes explicit permission and enumeration failures", () => {
  assert.equal(
    getMicrophoneStatus({ ...connected, tracks: [], permission: MicPermissionState.Denied })
      .capture,
    "permission",
  );
  assert.equal(
    getMicrophoneStatus({ ...connected, tracks: [], inputState: AudioDeviceState.Missing }).capture,
    "missing",
  );
  assert.equal(
    getMicrophoneStatus({ ...connected, tracks: [], inputState: AudioDeviceState.Failed }).capture,
    "unavailable",
  );
  assert.equal(
    getMicrophoneStatus({ ...connected, tracks: [], connection: RoomConnectionState.Joining })
      .capture,
    "preparing",
  );
  assert.equal(
    getMicrophoneStatus({ ...connected, inputState: AudioDeviceState.Missing }).capture,
    "active",
  );
});
