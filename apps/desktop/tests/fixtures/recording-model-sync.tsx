import { createRoot } from "react-dom/client";
import type {
  AppSettings,
  DesktopApi,
  RecordingLibraryItem,
  VoiceMemoryRecord,
  VoiceMemoryProcessRequest,
} from "@private-voice/shared";
import "../../src/renderer/src/styles/index.css";

const date = "2026-10-19T00:00:00.000Z";
const recording = {
  recordingId: "test-recording",
  filePath: "fixture.wav",
  roomId: "main",
  markers: [],
  voiceMemoryRecovery:
    new URLSearchParams(location.search).get("recovery") === "legacy_unverified"
      ? "legacy_unverified"
      : undefined,
} as unknown as RecordingLibraryItem;
let settings = {
  aiTranscriptionProvider: "cloud",
  aiAsrModel: "paraformer-zh",
  aiOrganizerProvider: "custom",
  aiRoomAskProvider: "custom",
  aiProcessingMode: "low_resource",
  isAiAutoTranscribeEnabled: true,
  isAiAutoOrganizeEnabled: false,
  isAiAutoUploadEnabled: false,
} as AppSettings;
let failNextSettingsSave = false;
window.addEventListener("fixture-fail-settings-save", () => {
  failNextSettingsSave = true;
});
let record: VoiceMemoryRecord | undefined;
let tick = 0;
const nextUpdate = () => new Date(Date.parse(date) + ++tick).toISOString();
const listeners = new Set<(value: VoiceMemoryRecord) => void>();
const modelStatusListeners = new Set<(value: unknown) => void>();
window.addEventListener("fixture-model-usage", (event) => {
  void window.desktopApi.ai.getSnapshot().then((snapshot) => {
    const next = { ...snapshot, modelConfigurationBusy: (event as CustomEvent<boolean>).detail };
    modelStatusListeners.forEach((listener) => listener(next));
  });
});
const emit = (value: VoiceMemoryRecord) => {
  record = value;
  listeners.forEach((listener) => listener(value));
};
window.desktopApi = {
  app: { writeLog: async () => {} },
  settings: {
    save: async (patch: Partial<AppSettings>) => {
      document.documentElement.dataset.lastSettingsPatch = JSON.stringify(patch);
      if (failNextSettingsSave) {
        failNextSettingsSave = false;
        throw new Error("fixture_settings_write_failed");
      }
      return (settings = { ...settings, ...patch });
    },
  },
  ai: {
    publishOrganization: async () => {
      document.documentElement.dataset.publishCalls = String(
        Number(document.documentElement.dataset.publishCalls ?? 0) + 1,
      );
      throw new Error("fixture_unexpected_publication");
    },
    controlModel: async (id: string) => {
      document.documentElement.dataset.downloadModel = id;
      return window.desktopApi.ai.getSnapshot();
    },
    getVoiceMemory: async () => record,
    getCustomProvider: async () => ({
      configured: true,
      hasApiKey: true,
      model: "glm-4-flash-250414",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    }),
    saveCustomProvider: async (value: { baseUrl: string; model: string }) => ({
      configured: true,
      hasApiKey: true,
      ...value,
    }),
    getTranscriptionProvider: async () => ({ cloudConfigured: true, customConfigured: true }),
    getSnapshot: async () => ({
      models: [
        {
          id: "qwen3-asr-0.6b-force",
          name: "Qwen3-ASR-0.6B + ForcedAligner",
          category: "asr",
          phase: "installed",
          runtimeReady: true,
          activeRevision: "fixture",
        },
        {
          id: "paraformer-zh",
          name: "Paraformer 中文套件",
          category: "asr",
          phase: "installed",
          runtimeReady: true,
          activeRevision: "fixture",
        },
      ],
      scheduler: { gameActive: false },
      checkedAt: date,
    }),
    onStatus: (listener: (value: unknown) => void) => {
      modelStatusListeners.add(listener);
      return () => modelStatusListeners.delete(listener);
    },
    onVoiceMemoryStatus: (listener: (value: VoiceMemoryRecord) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    processRecording: async (request: VoiceMemoryProcessRequest) => {
      document.documentElement.dataset.lastProcessRequest = JSON.stringify(request);
      const queued = {
        schemaVersion: 1,
        ...recording,
        createdAt: date,
        updatedAt: nextUpdate(),
        phase: "idle",
        taskStatus: "pending",
        processingStage: "recording",
        progress: 0,
        transcript: request.transcribe ? [] : (record?.transcript ?? []),
        speakers: request.transcribe ? [] : (record?.speakers ?? []),
        summary: [],
        chapters: [],
        highlights: [],
        markerTitles: [],
        timeline: [],
      } as VoiceMemoryRecord;
      emit({
        ...queued,
        updatedAt: nextUpdate(),
        phase: "transcribing",
        taskStatus: "processing",
        processingStage: "asr",
        diagnostic: {
          taskId: "fixture",
          fileName: "fixture.wav",
          updatedAt: date,
          stage: "asr",
          status: "processing",
          runtimeMessage: "正在转录第 1/3 段，完成后自动合并",
        },
      });
      return queued;
    },
    pauseTask: async () => {
      if (record) emit({ ...record, updatedAt: nextUpdate(), phase: "paused" });
    },
  },
} as unknown as DesktopApi;
window.addEventListener("fixture-recording-ready", () => {
  if (!record) return;
  emit({
    ...record,
    updatedAt: nextUpdate(),
    phase: "ready",
    taskStatus: "success",
    progress: 100,
    transcriptionPipelineVersion: 10,
    transcriptionModel: { id: "siliconflow-sensevoice-small", name: "SenseVoiceSmall" },
    transcriptionElapsedMs: 1000,
    transcript: [
      {
        id: "cloud-sentence",
        recordingId: recording.recordingId,
        startMs: 0,
        endMs: 1000,
        text: "已经保存的云端文字。",
        speakerId: "Speaker 1",
      },
    ],
  });
});
window.addEventListener("fixture-show-hybrid", () => {
  const cloud = [
    {
      id: "cloud-original",
      recordingId: recording.recordingId,
      speakerId: "member",
      startMs: 0,
      endMs: 10000,
      text: "云端原稿：第一句。第二句。第三句。",
    },
  ];
  emit({
    schemaVersion: 1,
    ...recording,
    createdAt: date,
    updatedAt: nextUpdate(),
    phase: "ready",
    progress: 100,
    taskStatus: "success",
    speakers: [],
    summary: [],
    chapters: [],
    highlights: [],
    markerTitles: [],
    timeline: [],
    transcriptionPipelineVersion: 10,
    transcriptionElapsedMs: 1000,
    transcriptionModel: { id: "qwen3-asr-0.6b-force", name: "千问 0.6B＋ForcedAligner" },
    transcriptionAssist: {
      status: "completed",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "qwen3-asr-0.6b-force",
    },
    transcript: [1000, 3000, 5000].map((startMs, index) => ({
      id: `local-${index}`,
      recordingId: recording.recordingId,
      speakerId: "member",
      startMs,
      endMs: startMs + 1500,
      text: `本地第${index + 1}句话。`,
      confidence: "high" as const,
    })),
    transcriptionVariants: {
      "siliconflow-sensevoice-small": {
        model: { id: "siliconflow-sensevoice-small", name: "SenseVoiceSmall" },
        transcript: cloud,
        speakers: [],
        updatedAt: date,
      },
    },
  } as VoiceMemoryRecord);
});
window.addEventListener("fixture-show-fused", () => {
  if (!record) return;
  emit({
    ...record,
    updatedAt: nextUpdate(),
    transcriptionFusion: {
      status: "completed",
      sourceSignature: "a".repeat(64),
      completedBatches: 1,
      totalBatches: 1,
      speakers: record.speakers,
      transcript: record.transcript.map((segment, i) => ({
        ...segment,
        fusionUncertain: false,
        text: `校对后的第${i + 1}句话。`,
      })),
    },
  });
});
window.addEventListener("fixture-show-summary", () => {
  if (!record) return;
  const summary = [1000, 3000, 5000, 7000].map((sourceStartMs, index) => ({
    text: `摘要要点${index + 1}`,
    sourceStartMs,
    sourceSegmentIds: [`local-${index}`],
  }));
  emit({
    ...record,
    phase: "ready",
    taskStatus: "success",
    updatedAt: nextUpdate(),
    organizedAt: nextUpdate(),
    summary,
    organization: {
      pipelineVersion: 1,
      modelId: "custom",
      modelRevision: "fixture",
      status: "completed",
      completedChunks: 1,
      chunks: [],
      startedAt: date,
      updatedAt: nextUpdate(),
      finalResult: {
        description: "合成录音的简短概述。",
        summary,
        topics: [],
        timeline: [],
        highlights: [],
        funnyMoments: [],
        importantInformation: [],
        participants: [],
        keywords: [],
      },
    },
  });
});
window.addEventListener("fixture-summary-failed", () => {
  if (!record) return;
  emit({
    ...record,
    updatedAt: nextUpdate(),
    phase: "error",
    taskStatus: "failed",
    processingStage: "organize",
    errorMessage: "organize_failed:custom_ai_invalid_json",
    summary: [],
    organization: {
      pipelineVersion: 5,
      modelId: "custom",
      modelRevision: "remote-v1",
      status: "failed",
      completedChunks: 0,
      chunks: [],
      startedAt: date,
      updatedAt: nextUpdate(),
    },
  });
});
const { VoiceMemoryDetail } =
  await import("../../src/renderer/src/components/settings/VoiceMemoryDetail");
const { AiVoiceMemorySettingsCard } =
  await import("../../src/renderer/src/components/settings/AiVoiceMemorySettingsCard");
const { useSettingsStore } = await import("../../src/renderer/src/store/settingsStore");
useSettingsStore.setState({ settings });
const Fixture = () => {
  const current = useSettingsStore((state) => state.settings)!;
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  return (
    <main className="recording-library-page" style={{ padding: 24 }}>
      <VoiceMemoryDetail
        recording={recording}
        roomName="测试房间"
        selectedAsrModel={current.aiAsrModel}
        onSeek={(value) => {
          document.documentElement.dataset.transcriptSeekMs = String(value);
        }}
      />
      <AiVoiceMemorySettingsCard
        settings={current}
        onChange={async (patch) => {
          await saveSettings(patch);
        }}
        pushToast={(message) => {
          document.documentElement.dataset.lastToast = message.title;
        }}
      />
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Fixture />);
