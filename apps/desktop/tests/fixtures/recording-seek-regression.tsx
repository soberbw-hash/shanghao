/* eslint-disable no-console -- isolated Electron fixture reports to its runner */
import React from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings } from "@private-voice/shared";

const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
const marker = { id: "original-marker", offsetMs: 61_000, createdAt: "2026-10-11T00:00:00Z" };
const item = {
  id: "same-recording-id",
  recordingId: "same-recording-id",
  filePath: "fixture-only.m4a",
  fileName: "fixture-only.m4a",
  roomName: "隔离夹具",
  markers: [marker],
  createdAt: "2026-10-11T14:36:00Z",
  modifiedAt: "2026-10-11T14:36:00Z",
  fileSize: 1000,
  isFavorite: false,
  mediaUrl: "",
  durationMs: 12_138_000,
};
const originalMarkers = JSON.stringify(item.markers);
let writes = 0;
const noSubscription = () => () => {};
window.desktopApi = {
  recording: {
    list: async () => ({
      directory: "isolated-fixture",
      totalBytes: 1000,
      quotaBytes: 20e9,
      items: [item],
    }),
    saveMarkers: async () => {
      writes++;
    },
    onScanWasteProgress: noSubscription,
  },
  ai: {
    getVoiceMemory: async () => undefined,
    listVoiceMemories: async () => [],
    getSnapshot: async () => ({ models: [] }),
    onVoiceMemoryStatus: noSubscription,
    onStatus: noSubscription,
  },
  app: { writeLog: async () => {} },
} as unknown as typeof window.desktopApi;
Object.defineProperty(HTMLMediaElement.prototype, "duration", {
  configurable: true,
  get: () => 12_138,
});
const { RecordingLibrarySettingsCard } =
  await import("../../src/renderer/src/components/settings/RecordingLibrarySettingsCard");
const settings = {
  recordingLibraryQuotaGb: 20,
  recordingSaveDirectory: "isolated-fixture",
  recordingClipBeforeMs: 20_000,
  recordingClipAfterMs: 8_000,
  aiAsrModel: "glm-asr-nano-2512",
  aiProcessingMode: "manual",
} as AppSettings;
const root = createRoot(document.getElementById("root")!);
root.render(
  <RecordingLibrarySettingsCard
    settings={settings}
    onChange={() => {
      writes++;
    }}
    pushToast={() => {}}
  />,
);
try {
  for (let attempt = 0; !document.querySelector(".recording-timeline") && attempt < 100; attempt++)
    await wait();
  const audio = document.querySelector("audio")!;
  if (!audio) throw Error("player did not mount");
  audio.dispatchEvent(new Event("loadedmetadata"));
  await wait();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  let seeks = 0;
  for (let cycle = 0; cycle < 8; cycle++) {
    (
      document.querySelector('[aria-label="对比这条录音的转录模型"]') ??
      document.querySelector('[aria-label="返回录音详情"]')
    )?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wait();
    for (let step = 0; step < 15; step++) {
      const timeline = document.querySelector<HTMLInputElement>(".recording-timeline")!;
      const wanted = (step * 719 + cycle * 89) % 12_138;
      setter.call(timeline, String(wanted));
      timeline.dispatchEvent(new Event("input", { bubbles: true }));
      timeline.dispatchEvent(new Event("change", { bubbles: true }));
      audio.dispatchEvent(new Event("timeupdate", { bubbles: true }));
      await wait();
      seeks++;
      if (Math.abs(audio.currentTime - wanted) > 0.1) throw Error("range did not seek audio");
      if (document.querySelectorAll(".recording-clips-panel").length !== 1)
        throw Error("duplicate clips panel after seek " + seeks);
      if (document.querySelectorAll(".recording-marker-dot").length !== 1)
        throw Error("marker count changed");
    }
  }
  if (writes || JSON.stringify(item.markers) !== originalMarkers)
    throw Error("seeking mutated marker data");
  console.log(
    "SEEK_RESULT:" +
      JSON.stringify({ seeks, comparisonToggles: 8, clipPanels: 1, markers: 1, writes }),
  );
} catch (error) {
  console.log("SEEK_FAILURE:" + String(error));
}
