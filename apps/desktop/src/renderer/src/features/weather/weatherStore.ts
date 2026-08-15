import type {
  LocalWeatherRequest,
  LocalWeatherSnapshot,
  WeatherDayPhase,
  WeatherSceneKind,
} from "@private-voice/shared";
import { create } from "zustand";

import { desktopApi } from "../../utils/desktopApi";

interface WeatherStoreState {
  snapshot?: LocalWeatherSnapshot;
  snapshotRequestKey?: string;
  isLoading: boolean;
  error?: string;
  preview?: { scene: WeatherSceneKind; phase: WeatherDayPhase };
  refresh: (request: LocalWeatherRequest) => Promise<LocalWeatherSnapshot>;
  setPreview: (preview?: { scene: WeatherSceneKind; phase: WeatherDayPhase }) => void;
  clear: () => void;
}

const activeRequests = new Map<string, Promise<LocalWeatherSnapshot>>();
let latestRequestKey = "";
type SystemPosition = NonNullable<LocalWeatherRequest["systemPosition"]>;
let pendingSystemPosition: Promise<SystemPosition | undefined> | undefined;

const readSystemPosition = (): Promise<SystemPosition | undefined> => {
  if (!navigator.geolocation) return Promise.resolve(undefined);
  pendingSystemPosition ??= new Promise<SystemPosition | undefined>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
      () => resolve(undefined),
      {
        enableHighAccuracy: true,
        timeout: 8_000,
        maximumAge: 30 * 60 * 1_000,
      },
    );
  }).finally(() => {
    pendingSystemPosition = undefined;
  });
  return pendingSystemPosition!;
};

const createRequestKey = (request: LocalWeatherRequest): string =>
  request.locationMode === "manual"
    ? `manual:${request.manualCity?.trim().toLocaleLowerCase("zh-CN") ?? ""}`
    : "auto";

export const useWeatherStore = create<WeatherStoreState>((set) => ({
  snapshot: undefined,
  snapshotRequestKey: undefined,
  isLoading: false,
  error: undefined,
  refresh: async (request) => {
    const requestKey = createRequestKey(request);
    latestRequestKey = requestKey;
    const existing = activeRequests.get(requestKey);
    if (existing && !request.forceRefresh) return existing;
    set({ isLoading: true, error: undefined });
    const task = (async () => {
      const systemPosition =
        request.locationMode === "auto" ? await readSystemPosition() : undefined;
      return desktopApi.weather.getSnapshot({ ...request, systemPosition });
    })()
      .then((snapshot) => {
        if (latestRequestKey === requestKey) {
          set({ snapshot, snapshotRequestKey: requestKey, isLoading: false, error: undefined });
        }
        return snapshot;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (latestRequestKey === requestKey) {
          set({ isLoading: false, error: message });
        }
        throw error;
      })
      .finally(() => {
        if (activeRequests.get(requestKey) === task) activeRequests.delete(requestKey);
      });
    activeRequests.set(requestKey, task);
    return task;
  },
  setPreview: (preview) => set({ preview }),
  clear: () => {
    latestRequestKey = "";
    set({
      snapshot: undefined,
      snapshotRequestKey: undefined,
      isLoading: false,
      error: undefined,
    });
  },
}));
