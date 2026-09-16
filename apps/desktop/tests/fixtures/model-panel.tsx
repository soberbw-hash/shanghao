import { createRoot } from "react-dom/client";
import type { RecordingLibraryItem, VoiceMemoryRecord } from "@private-voice/shared";
import { ModelTestPanel } from "../../src/renderer/src/components/settings/ModelTestPanel";
import {
  modelComparisonQueue,
  type ModelComparisonJobSnapshot,
} from "../../src/renderer/src/features/ai/modelComparisonQueue";

// Only this isolated Vite fixture substitutes the queue/API; no IPC or model process exists.
const id = "fixture-recording";
const models = [{ id: "ark-asr-3b-q8_0", category: "asr", activeRevision: "fixture" }];
let job: ModelComparisonJobSnapshot | undefined = {
  recordingId: id,
  modelIds: ["ark-asr-3b-q8_0"],
  currentIndex: 0,
  currentProgress: 1,
  currentPhase: "success",
  phase: "complete",
  results: {},
};
const listeners = new Set<(next: ModelComparisonJobSnapshot | undefined) => void>();
const emit = () => listeners.forEach((listener) => listener(job));
modelComparisonQueue.get = () => job;
modelComparisonQueue.subscribe = (_id, listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
modelComparisonQueue.clear = async () => {
  job = undefined;
  emit();
  return undefined;
};
modelComparisonQueue.start = () => {
  job = {
    recordingId: id,
    modelIds: ["ark-asr-3b-q8_0"],
    currentIndex: 0,
    currentProgress: 0,
    currentPhase: "loading",
    phase: "running",
    results: {},
  };
  emit();
  setTimeout(() => {
    job = { ...job!, phase: "paused", currentPhase: "failed", error: "fixture failure" };
    emit();
  }, 100);
};
modelComparisonQueue.resume = () => {
  job = { ...job!, phase: "running", currentPhase: "transcribing" };
  emit();
};
window.confirm = () => true;
window.desktopApi = {
  ai: {
    getSnapshot: async () => ({ models }),
    getVoiceMemory: async (): Promise<VoiceMemoryRecord | undefined> => undefined,
    onVoiceMemoryStatus: () => () => undefined,
  },
} as unknown as typeof window.desktopApi;
createRoot(document.getElementById("root")!).render(
  <ModelTestPanel
    recording={{ recordingId: id, id, markers: [] } as unknown as RecordingLibraryItem}
    recordingTitle="隔离测试"
    audioDurationMs={600000}
    onClose={() => undefined}
    onSeek={() => undefined}
  />,
);
