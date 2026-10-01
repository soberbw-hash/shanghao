import { create } from "zustand";

import type { DailyRoomReport } from "@private-voice/shared";

type RoomId = string;

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

const emptyReports = (): Record<RoomId, DailyRoomReport[]> => ({});

export const mergeDailyRoomReports = (
  local: DailyRoomReport[],
  incoming: DailyRoomReport[],
): DailyRoomReport[] => {
  const byDate = new Map(
    local.filter((report) => report.hadActivity).map((report) => [report.date, report]),
  );
  for (const report of incoming) {
    if (!report.hadActivity) continue;
    const cached = byDate.get(report.date);
    if (!cached) {
      byDate.set(report.date, report);
      continue;
    }
    const incomingRevision = report.revision ?? 0;
    const cachedRevision = cached.revision ?? 0;
    const incomingUpdatedAt = Date.parse(report.updatedAt ?? "") || 0;
    const cachedUpdatedAt = Date.parse(cached.updatedAt ?? "") || 0;
    if (
      incomingRevision > cachedRevision ||
      (incomingRevision === cachedRevision && incomingUpdatedAt >= cachedUpdatedAt)
    ) {
      byDate.set(report.date, report);
    }
  }
  return [...byDate.values()]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 14);
};

const persistReports = (reports: Record<RoomId, DailyRoomReport[]>): void => {
  void window.desktopApi.app.saveDailyRoomReports(reports).catch(() => undefined);
};

export const useDailyRoomReportStore = create<DailyRoomReportStoreState>((set) => ({
  reports: emptyReports(),
  loaded: {},
  unavailable: {},
  hydrated: false,
  hydrate: async () => {
    if (useDailyRoomReportStore.getState().hydrated) return;
    try {
      const cached = await window.desktopApi.app.readDailyRoomReports();
      set((state) => {
        if (state.hydrated) return state;
        const reports = Object.fromEntries(
          [...new Set([...Object.keys(cached), ...Object.keys(state.reports)])].map((roomId) => [
            roomId,
            mergeDailyRoomReports(cached[roomId] ?? [], state.reports[roomId] ?? []),
          ]),
        );
        return {
          reports,
          loaded: Object.fromEntries(Object.keys(reports).map((roomId) => [roomId, true])),
          hydrated: true,
        };
      });
    } catch {
      set({ hydrated: true });
    }
  },
  beginLoading: (roomIds = []) =>
    set((state) => ({
      loaded: Object.fromEntries(
        [...new Set([...Object.keys(state.loaded), ...roomIds])].map((roomId) => [
          roomId,
          roomIds.includes(roomId) && !state.reports[roomId]?.length ? false : state.loaded[roomId],
        ]),
      ) as Record<RoomId, boolean>,
      unavailable: Object.fromEntries(
        [...new Set([...Object.keys(state.unavailable), ...roomIds])].map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? false : state.unavailable[roomId],
        ]),
      ) as Record<RoomId, boolean>,
    })),
  setReports: (roomId, reports) =>
    set((state) => {
      const nextReports = {
        ...state.reports,
        [roomId]: mergeDailyRoomReports(state.reports[roomId] ?? [], reports),
      };
      persistReports(nextReports);
      return {
        reports: nextReports,
        loaded: { ...state.loaded, [roomId]: true },
        unavailable: { ...state.unavailable, [roomId]: false },
        hydrated: true,
      };
    }),
  setUnavailable: (roomIds = []) =>
    set((state) => ({
      loaded: Object.fromEntries(
        [...new Set([...Object.keys(state.loaded), ...roomIds])].map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? true : state.loaded[roomId],
        ]),
      ) as Record<RoomId, boolean>,
      unavailable: Object.fromEntries(
        [...new Set([...Object.keys(state.unavailable), ...roomIds])].map((roomId) => [
          roomId,
          roomIds.includes(roomId) ? true : state.unavailable[roomId],
        ]),
      ) as Record<RoomId, boolean>,
    })),
  reset: () =>
    set({
      reports: emptyReports(),
      loaded: {},
      unavailable: {},
      hydrated: false,
    }),
}));
