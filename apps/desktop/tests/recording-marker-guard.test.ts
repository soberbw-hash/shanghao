import assert from "node:assert/strict";
import test from "node:test";
import { RecordingState } from "@private-voice/shared";
import { useRecordingStore } from "../src/renderer/src/store/recordingStore";

test("only active recording accepts new marker IDs; playback cannot add markers", () => {
  const previous = useRecordingStore.getState();
  const marker = { id: "fixture-marker", offsetMs: 61_000, createdAt: "2026-10-16T00:00:00Z" };
  try {
    useRecordingStore.setState({
      markers: [],
      status: { state: RecordingState.Idle, durationMs: 0 },
    });
    useRecordingStore.getState().addMarker(marker);
    assert.equal(useRecordingStore.getState().markers.length, 0);
    useRecordingStore.getState().setStatus({ state: RecordingState.Recording, durationMs: 61_000 });
    useRecordingStore.getState().addMarker(marker);
    useRecordingStore.getState().addMarker(marker);
    assert.equal(useRecordingStore.getState().markers.length, 1);
    useRecordingStore.getState().setStatus({ state: RecordingState.Saving, durationMs: 61_000 });
    useRecordingStore.getState().addMarker({ ...marker, id: "late-marker" });
    assert.deepEqual(useRecordingStore.getState().markers, [marker]);
  } finally {
    useRecordingStore.setState(previous, true);
  }
});
