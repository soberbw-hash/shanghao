import { RecordingState, type RecordingResult, type RecordingStatusSnapshot } from "@private-voice/shared";
import { create } from "zustand";

const STORAGE_KEY = "shanghao:recordings";
const MAX_RECORDINGS = 20;

const loadRecordings = (): RecordingResult[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data) as RecordingResult[];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
};

const saveRecordings = (recordings: RecordingResult[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
  } catch {
    // Ignore storage errors
  }
};

interface RecordingStoreState {
  status: RecordingStatusSnapshot;
  history: RecordingResult[];
  setStatus: (status: RecordingStatusSnapshot) => void;
  addHistory: (result: RecordingResult) => void;
  deleteRecording: (index: number) => void;
  resetStatus: () => void;
}

export const useRecordingStore = create<RecordingStoreState>((set, get) => ({
  status: {
    state: RecordingState.Idle,
    durationMs: 0,
  },
  history: loadRecordings(),
  setStatus: (status) => set({ status }),
  addHistory: (result) => {
    const newHistory = [result, ...get().history].slice(0, MAX_RECORDINGS);
    saveRecordings(newHistory);
    set({ history: newHistory });
  },
  deleteRecording: (index: number) => {
    const newHistory = get().history.filter((_, i) => i !== index);
    saveRecordings(newHistory);
    set({ history: newHistory });
  },
  resetStatus: () =>
    set({
      status: {
        state: RecordingState.Idle,
        durationMs: 0,
      },
    }),
}));
