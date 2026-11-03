import assert from "node:assert/strict";
import test from "node:test";
import type { RecordingLibraryItem } from "@private-voice/shared";
import { recordingDisplayTitle } from "../src/renderer/src/features/recording/recordingDisplayTitle";

test("default names use local recording time while custom names remain unchanged", () => {
  const item = {
    fileName: "上号-2026-10-29-语音01-08时30分.m4a",
    title: "上号-2026-10-29-语音01-08时30分",
    createdAt: "2026-10-29T08:30:00",
    modifiedAt: "2026-10-29T08:30:00",
  } as RecordingLibraryItem;
  for (const [hour, label] of [
    [0, "凌晨"],
    [5, "早上"],
    [9, "上午"],
    [11, "中午"],
    [13, "下午"],
    [18, "晚上"],
  ] as const) {
    assert.equal(
      recordingDisplayTitle(
        { ...item, createdAt: `2026-10-29T${String(hour).padStart(2, "0")}:00:00` },
        1,
      ),
      `${label} · 语音 01`,
    );
  }
  assert.equal(
    recordingDisplayTitle({ ...item, title: "精彩对局", isCustomTitle: true }, 2),
    "精彩对局",
  );
  assert.equal(recordingDisplayTitle({ ...item, createdAt: "invalid" }, 2), "语音 02");
});
