import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  type AppSettings,
  type DesktopApi,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";
import { RecordingLibrarySettingsCard } from "../../src/renderer/src/components/settings/RecordingLibrarySettingsCard";
import { useSettingsStore } from "../../src/renderer/src/store/settingsStore";
import "../../src/renderer/src/styles/index.css";

// Synthetic silent bytes only; no recording path or audio from a real profile is used.
const silent = new Uint8Array(44 + 3200);
const view = new DataView(silent.buffer);
const write = (offset: number, text: string) =>
  [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
write(0, "RIFF");
view.setUint32(4, silent.length - 8, true);
write(8, "WAVEfmt ");
view.setUint32(16, 16, true);
view.setUint16(20, 1, true);
view.setUint16(22, 1, true);
view.setUint32(24, 16000, true);
view.setUint32(28, 32000, true);
view.setUint16(32, 2, true);
view.setUint16(34, 16, true);
write(36, "data");
view.setUint32(40, 3200, true);
const mediaUrl = `data:audio/wav;base64,${btoa(String.fromCharCode(...silent))}`;
const currentTimes = new WeakMap<HTMLMediaElement, number>();
Object.defineProperty(HTMLMediaElement.prototype, "duration", {
  configurable: true,
  get() {
    return this.getAttribute("src")?.endsWith("#long") ? 9823 : 800;
  },
});
Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
  configurable: true,
  get() {
    return currentTimes.get(this) ?? 0;
  },
  set(value: number) {
    currentTimes.set(this, value);
  },
});
HTMLMediaElement.prototype.load = function () {
  if (this.getAttribute("src"))
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
};
HTMLMediaElement.prototype.pause = function () {
  this.dispatchEvent(new Event("pause"));
};
HTMLMediaElement.prototype.play = async function () {
  this.dispatchEvent(new Event("play"));
};

const date = "2026-10-19T11:30:00+08:00";
const cardLayout = new URLSearchParams(location.search).has("cards");
const markers = [
  { id: "start", offsetMs: 0, label: "演示 · 开场集合", createdAt: date },
  { id: "game", offsetMs: 61000, label: "演示 · 09:47 启动了英雄联盟", createdAt: date },
  { id: "middle", offsetMs: 400000, label: "演示 · 中场精彩配合", createdAt: date },
  { id: "end", offsetMs: 800000, label: "演示 · 本局结束", createdAt: date },
];
const item: RecordingLibraryItem = {
  id: "demo-recording",
  recordingId: "demo-recording",
  title: "演示 · 周末开黑与战术复盘",
  isCustomTitle: true,
  fileName: "demo-recording.m4a",
  filePath: "demo-only/recording.m4a",
  mediaUrl,
  createdAt: date,
  modifiedAt: date,
  fileSize: 12_400_000,
  roomId: "main",
  roomName: "演示房间",
  isFavorite: true,
  markers,
};
const record: VoiceMemoryRecord = {
  schemaVersion: 1,
  recordingId: item.recordingId,
  filePath: item.filePath,
  roomId: "main",
  roomName: "演示房间",
  createdAt: date,
  updatedAt: date,
  phase: "ready",
  progress: 100,
  taskStatus: "success",
  processingStage: "storage",
  transcriptionPipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  transcriptionModel: { id: "siliconflow-sensevoice-small", name: "SenseVoiceSmall" },
  transcriptionElapsedMs: 12300,
  organizedAt: date,
  speakers: [
    { speakerId: "demo-a", nickname: "演示队友 A", confidence: "high" },
    { speakerId: "demo-b", nickname: "演示队友 B", confidence: "high" },
  ],
  transcript: [
    {
      id: "demo-1",
      recordingId: item.recordingId,
      startMs: 50000,
      endMs: 65000,
      speakerId: "demo-a",
      nickname: "演示队友 A",
      confidence: "high",
      text: "演示：大家先在中路集合，等兵线过来后再一起推进。注意保留控制技能，后排保持距离。",
      words: [
        { id: "demo-word-1", text: "演示：大家先在中路集合，", startMs: 50000, endMs: 55000 },
        { id: "demo-word-2", text: "等兵线过来后再一起推进。", startMs: 56000, endMs: 61000 },
        {
          id: "demo-word-3",
          text: "注意保留控制技能，后排保持距离。",
          startMs: 62000,
          endMs: 65000,
        },
      ],
    },
    {
      id: "demo-2",
      recordingId: item.recordingId,
      startMs: 68000,
      endMs: 82000,
      speakerId: "demo-b",
      nickname: "演示队友 B",
      confidence: "high",
      text: "演示：收到。我会先观察河道视野，等大家到齐再开团，刚才那段配合可以留个标记。",
    },
    {
      id: "demo-3",
      recordingId: item.recordingId,
      startMs: 400000,
      endMs: 418000,
      speakerId: "demo-a",
      nickname: "演示队友 A",
      confidence: "high",
      text: "演示：这波配合很顺，先控住对方前排，再集中输出。下一局继续按这个节奏来。",
    },
  ],
  summary: [
    {
      text: "演示：先集合、补足河道视野，再统一推进；标记精彩配合，方便赛后回看。",
      sourceStartMs: 50000,
    },
  ],
  chapters: [{ id: "demo-chapter", startMs: 50000, title: "演示 · 团队集合与推进" }],
  highlights: [{ id: "demo-highlight", startMs: 400000, endMs: 418000, title: "演示 · 中场配合" }],
  markerTitles: [],
  timeline: [{ id: "game", kind: "marker", offsetMs: 61000, title: "演示 · 启动游戏" }],
};
const settings = {
  recordingLibraryQuotaGb: 20,
  isRecordingWasteAutoCleanupEnabled: true,
  recordingClipBeforeMs: 20000,
  recordingClipAfterMs: 8000,
  aiAsrModel: "paraformer-zh",
  aiTranscriptionProvider: "cloud",
  isAiAutoTranscribeEnabled: true,
  isAiAutoOrganizeEnabled: true,
  isAiAutoUploadEnabled: false,
} as AppSettings;
useSettingsStore.setState({ settings });
const statusListeners = new Set<(value: VoiceMemoryRecord) => void>();
window.addEventListener("recording-fixture-state", (event) => {
  const state = (event as CustomEvent<string>).detail;
  if (state === "dense") {
    const transcript = Array.from({ length: 80 }, (_, index) => ({
      ...record.transcript[index % record.transcript.length]!,
      id: `dense-${index}`,
      startMs: index * 30_000,
      endMs: index * 30_000 + 15_000,
      words: undefined,
    }));
    for (const listener of statusListeners) listener({ ...record, transcript });
    return;
  }
  const next: VoiceMemoryRecord =
    state === "ready"
      ? record
      : {
          ...record,
          phase: state === "failed" ? "ready" : "organizing",
          processingStage: "organize",
          taskStatus: state === "failed" ? "failed" : "processing",
          organizedAt: undefined,
          summary: [],
          errorMessage: state === "failed" ? "organize_failed:cloud_ai_busy" : undefined,
          organization: {
            pipelineVersion: 1,
            modelId: "cloud",
            modelRevision: "fixture",
            status: state === "failed" ? "failed" : "running",
            completedChunks: 0,
            chunks: [],
            startedAt: date,
            updatedAt: date,
          },
        };
  for (const listener of statusListeners) listener(next);
});
window.desktopApi = {
  app: { writeLog: async () => {} },
  recording: {
    list: async () => ({
      directory: "演示录音库",
      totalBytes: item.fileSize,
      quotaBytes: 20 * 1024 ** 3,
      items: [
        item,
        {
          ...item,
          id: "demo-2",
          recordingId: "demo-2",
          title: "演示 · 双人语音练习",
          isFavorite: false,
          markers: [],
          fileSize: 6_800_000,
          mediaUrl: cardLayout ? `${mediaUrl}#long` : mediaUrl,
          createdAt: cardLayout ? date : "2026-10-18T20:10:00+08:00",
        },
      ],
    }),
  },
  ai: {
    getVoiceMemory: async (recordingId: string) =>
      cardLayout
        ? {
            ...record,
            recordingId,
            phase: "error",
            taskStatus: "failed",
            progress: recordingId === item.recordingId ? 11 : 1,
            errorMessage: "cloud_asr_temporarily_unavailable",
          }
        : record,
    listVoiceMemories: async () =>
      cardLayout
        ? [item.recordingId, "demo-2"].map((recordingId, index) => ({
            ...record,
            recordingId,
            phase: "error",
            taskStatus: "failed",
            progress: index ? 1 : 11,
            transcriptCount: 3,
            errorMessage: "cloud_asr_temporarily_unavailable",
          }))
        : [
            {
              recordingId: item.recordingId,
              filePath: item.filePath,
              roomId: item.roomId,
              createdAt: date,
              updatedAt: date,
              phase: "ready",
              progress: 100,
              transcriptCount: record.transcript.length,
              speakerCount: 2,
              chapterCount: 1,
              highlightCount: 1,
              markerCount: markers.length,
              transcriptionComplete: true,
              invalidResult: false,
              transcriptionModel: record.transcriptionModel,
            },
          ],
    searchMemory: async ({ query }: { query: string }) => {
      document.documentElement.dataset.searchCount = String(
        Number(document.documentElement.dataset.searchCount ?? 0) + 1,
      );
      if (document.documentElement.dataset.delayNextSearch === "true") {
        document.documentElement.dataset.delayNextSearch = "false";
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      return query.includes("战术")
        ? [
            {
              recordingId: item.recordingId,
              filePath: item.filePath,
              roomName: item.roomName,
              createdAt: date,
              startMs: 61000,
              title: "战术",
              excerpt: "演示：我们先讨论战术，再一起推进。",
              score: 1,
              kind: "transcript",
            },
          ]
        : [];
    },
    onVoiceMemoryStatus: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    getSnapshot: async () => ({ models: [], scheduler: { gameActive: false } }),
    onStatus: () => () => {},
  },
} as unknown as DesktopApi;

const Fixture = () => {
  const [current, setCurrent] = useState(settings);
  return (
    <main
      style={{
        padding: "20px 28px",
        maxWidth: 1440,
        margin: "0 auto",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <div>
          <p style={{ color: "#5d7d9d", fontSize: 12, marginBottom: 8 }}>SHANGHAO · 上号开发候选</p>
          <h1 style={{ fontSize: 26, fontWeight: 750, color: "#172f4b" }}>录音与语音记忆</h1>
        </div>
        <p style={{ color: "#6c7d90", fontSize: 12 }}>演示数据 · 不含私人录音</p>
      </header>
      <div className="settings-recording-content">
        <RecordingLibrarySettingsCard
          settings={current}
          onChange={(patch) => setCurrent((previous) => ({ ...previous, ...patch }))}
          pushToast={() => {}}
        />
      </div>
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Fixture />);
