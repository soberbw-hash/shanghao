import { RecordingState, type RecordingResult, type RecordingStatusSnapshot } from "@private-voice/shared";
import { create } from "zustand";

interface RecordingStoreState {
  status: RecordingStatusSnapshot;
  history: RecordingResult[];
  setStatus: (status: RecordingStatusSnapshot) => void;
  addHistory: (result: RecordingResult) => void;
  resetStatus: () => void;
}

export const useRecordingStore = create<RecordingStoreState>((set) => ({
  status: {
    state: RecordingState.Idle,
    durationMs: 0,
  },
  history: [],
  setStatus: (status) => set({ status }),
  addHistory: (result) =>
    set((state) => ({
      history: [result, ...state.history].slice(0, 10),
    })),
  resetStatus: () =>
    set({
      status: {
        state: RecordingState.Idle,
        durationMs: 0,
      },
    }),
}));
