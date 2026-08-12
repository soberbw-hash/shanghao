import { create } from "zustand";

import type { DailyRoomReport } from "@private-voice/shared";

type RoomId = "main" | "side";

interface DailyRoomReportStoreState {
  reports: Record<RoomId, DailyRoomReport[]>;
  loaded: Record<RoomId, boolean>;
  unavailable: Record<RoomId, boolean>;
  beginLoading: (roomIds?: RoomId[]) => void;
  setReports: (roomId: RoomId, reports: DailyRoomReport[]) => void;
  setUnavailable: (roomIds?: RoomId[]) => void;
  reset: () => void;
}

const emptyReports = (): Record<RoomId, DailyRoomReport[]> => ({ main: [], side: [] });

export const useDailyRoomReportStore = create<DailyRoomReportStoreState>((set) => ({
  reports: emptyReports(),
  loaded: { main: false, side: false },
  unavailable: { main: false, side: false },
  beginLoading: (roomIds = ["main", "side"]) =>
    set((state) => ({
      loaded: Object.fromEntries(
        (["main", "side"] as RoomId[]).map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? false : state.loaded[roomId],
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
    set((state) => ({
      reports: {
        ...state.reports,
        [roomId]: [...reports].sort((a, b) => b.date.localeCompare(a.date)),
      },
      loaded: { ...state.loaded, [roomId]: true },
      unavailable: { ...state.unavailable, [roomId]: false },
    })),
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
    }),
}));
