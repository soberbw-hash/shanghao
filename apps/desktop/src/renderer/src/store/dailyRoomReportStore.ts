import { create } from "zustand";

import type { DailyRoomReport } from "@private-voice/shared";

type RoomId = "main" | "side";

interface DailyRoomReportStoreState {
  reports: Record<RoomId, DailyRoomReport[]>;
  loaded: Record<RoomId, boolean>;
  unavailable: Record<RoomId, boolean>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  beginLoading: (roomIds?: RoomId[]) => void;
  setReports: (roomId: RoomId, reports: DailyRoomReport[]) => void;
  setUnavailable: (roomIds?: RoomId[]) => void;
  reset: () => void;
}

const emptyReports = (): Record<RoomId, DailyRoomReport[]> => ({ main: [], side: [] });

const persistReports = (reports: Record<RoomId, DailyRoomReport[]>): void => {
  void window.desktopApi.app.saveDailyRoomReports(reports).catch(() => undefined);
};

export const useDailyRoomReportStore = create<DailyRoomReportStoreState>((set) => ({
  reports: emptyReports(),
  loaded: { main: false, side: false },
  unavailable: { main: false, side: false },
  hydrated: false,
  hydrate: async () => {
    if (useDailyRoomReportStore.getState().hydrated) return;
    try {
      const cached = await window.desktopApi.app.readDailyRoomReports();
      set((state) => {
        if (state.hydrated) return state;
        const reports = {
          main: state.reports.main.length ? state.reports.main : cached.main,
          side: state.reports.side.length ? state.reports.side : cached.side,
        };
        return {
          reports,
          loaded: { main: true, side: true },
          hydrated: true,
        };
      });
    } catch {
      set({ loaded: { main: true, side: true }, hydrated: true });
    }
  },
  beginLoading: (roomIds = ["main", "side"]) =>
    set((state) => ({
      loaded: Object.fromEntries(
        (["main", "side"] as RoomId[]).map((roomId) => [
          roomId,
          roomIds.includes(roomId) && state.reports[roomId].length === 0
            ? false
            : state.loaded[roomId],
        ]),
      ) as Record<RoomId, boolean>,
      unavailable: Object.fromEntries(
        (["main", "side"] as RoomId[]).map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? false : state.unavailable[roomId],
        ]),
      ) as Record<RoomId, boolean>,
    })),
  setReports: (roomId, reports) =>
    set((state) => {
      const nextReports = {
        ...state.reports,
        [roomId]: [...reports].sort((a, b) => b.date.localeCompare(a.date)),
      };
      persistReports(nextReports);
      return {
        reports: nextReports,
        loaded: { ...state.loaded, [roomId]: true },
        unavailable: { ...state.unavailable, [roomId]: false },
        hydrated: true,
      };
    }),
  setUnavailable: (roomIds = ["main", "side"]) =>
    set((state) => ({
      loaded: Object.fromEntries(
        (["main", "side"] as RoomId[]).map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? true : state.loaded[roomId],
        ]),
      ) as Record<RoomId, boolean>,
      unavailable: Object.fromEntries(
        (["main", "side"] as RoomId[]).map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? true : state.unavailable[roomId],
        ]),
      ) as Record<RoomId, boolean>,
    })),
  reset: () =>
    set({
      reports: emptyReports(),
      loaded: { main: false, side: false },
      unavailable: { main: false, side: false },
      hydrated: false,
    }),
}));
