import { app, screen, type BrowserWindow, type ProcessMetric } from "electron";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  type RendererRuntimeHealthInput,
  type RuntimeHealthSnapshot,
  type RuntimeProcessHealth,
} from "@private-voice/shared";

import type { FlightRecorder } from "./flight-recorder";

const bytesFromKilobytes = (value: number | undefined): number | undefined =>
  typeof value === "number" ? Math.round(value * 1_024) : undefined;

const processHealth = (metric: ProcessMetric): RuntimeProcessHealth => ({
  pid: metric.pid,
  type: metric.type,
  cpuPercent: metric.cpu?.percentCPUUsage,
  workingSetBytes: bytesFromKilobytes(metric.memory?.workingSetSize),
  privateBytes: bytesFromKilobytes(metric.memory?.privateBytes),
});

const readGpuIdentity = async (): Promise<
  Pick<RuntimeHealthSnapshot["gpu"], "vendor" | "device" | "driver" | "angleBackend">
> => {
  const info = (await app.getGPUInfo("basic").catch(() => undefined)) as
    { gpuDevice?: Array<Record<string, unknown>> } | undefined;
  const primary = info?.gpuDevice?.find((device) => device.active === true) ?? info?.gpuDevice?.[0];
  if (!primary) return {};
  const value = (key: string): string | undefined => {
    const candidate = primary[key];
    return typeof candidate === "string" || typeof candidate === "number"
      ? String(candidate)
      : undefined;
  };
  return {
    vendor: value("vendorString") ?? value("vendorId"),
    device: value("deviceString") ?? value("deviceId"),
    driver: value("driverVersion"),
    angleBackend: value("glRenderer") ?? value("glVersion"),
  };
};

// GPU identity cannot change during a process lifetime. Avoid a driver query on every
// diagnostics refresh, especially while the settings page is open for a long session.
let gpuIdentityPromise: ReturnType<typeof readGpuIdentity> | undefined;
const cachedGpuIdentity = (): ReturnType<typeof readGpuIdentity> => {
  gpuIdentityPromise ??= readGpuIdentity();
  return gpuIdentityPromise;
};

export const captureRuntimeHealth = async (options: {
  getMainWindow: () => BrowserWindow | null;
  renderer?: RendererRuntimeHealthInput;
  flightRecorder: FlightRecorder;
}): Promise<RuntimeHealthSnapshot> => {
  const window = options.getMainWindow();
  const metrics = app.getAppMetrics();
  const mainMetric = metrics.find((metric) => metric.pid === process.pid);
  const rendererPid =
    window && !window.isDestroyed() ? window.webContents.getOSProcessId() : undefined;
  const rendererMetric = metrics.find((metric) => metric.pid === rendererPid);
  const display =
    window && !window.isDestroyed()
      ? screen.getDisplayMatching(window.getBounds())
      : screen.getPrimaryDisplay();
  const systemMemory = process.getSystemMemoryInfo();
  const featureStatus = app.getGPUFeatureStatus();
  const gpuIdentity = await cachedGpuIdentity();
  const processes = metrics.map(processHealth);
  const rendererRoom = options.renderer?.room;
  const screenFallbackActive = rendererRoom?.screenShareRelayState === "active";

  const snapshot: RuntimeHealthSnapshot = {
    capturedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    protocolVersion: APP_PROTOCOL_VERSION,
    buildNumber: APP_BUILD_NUMBER,
    uptimeMs: Math.round(process.uptime() * 1_000),
    main: mainMetric
      ? {
          ...processHealth(mainMetric),
          jsHeapUsedBytes: process.memoryUsage().heapUsed,
          activeResourceCount: process.getActiveResourcesInfo?.().length,
        }
      : {
          pid: process.pid,
          type: "Browser",
          jsHeapUsedBytes: process.memoryUsage().heapUsed,
          activeResourceCount: process.getActiveResourcesInfo?.().length,
        },
    renderer: rendererMetric
      ? {
          ...processHealth(rendererMetric),
          jsHeapUsedBytes: options.renderer?.jsHeapUsedBytes,
          jsHeapTotalBytes: options.renderer?.jsHeapTotalBytes,
          domNodeCount: options.renderer?.domNodeCount,
        }
      : undefined,
    processes,
    system: {
      totalMemoryBytes: bytesFromKilobytes(systemMemory.total),
      freeMemoryBytes: bytesFromKilobytes(systemMemory.free),
    },
    gpu: {
      hardwareAcceleration: featureStatus.gpu_compositing !== "disabled_software",
      featureStatus: Object.fromEntries(
        Object.entries(featureStatus).map(([key, value]) => [key, String(value)]),
      ),
      compositing: featureStatus.gpu_compositing,
      rasterization: featureStatus.rasterization,
      webgl: featureStatus.webgl,
      webgl2: featureStatus.webgl2,
      videoDecode: featureStatus.video_decode,
      videoEncode: featureStatus.video_encode,
      ...gpuIdentity,
    },
    display: {
      id: String(display.id),
      label: display.label || undefined,
      refreshRateHz: display.displayFrequency || options.renderer?.performance.displayRefreshRateHz,
      scaleFactor: display.scaleFactor,
      width: display.size.width,
      height: display.size.height,
    },
    rendererPerformance: options.renderer?.performance,
    realtime: {
      phaseId: options.renderer?.phaseId,
      roomLifecycleState: rendererRoom?.roomLifecycleState,
      roomConnectionState: rendererRoom?.roomConnectionState,
      roomId: rendererRoom?.currentRoomId,
      localStreamActive: rendererRoom?.localStreamActive,
      phoneMicStatus: options.renderer?.phoneMicStatus,
      peerCount: rendererRoom?.remotePeerCount ?? 0,
      reconnectAttempts: rendererRoom?.reconnectAttempts ?? 0,
      connectionGeneration: rendererRoom?.connectionGeneration,
      trackCount: options.renderer?.trackCount ?? 0,
      audioNodeCount: options.renderer?.audioNodeCount,
      audioContextCount: options.renderer?.audioContextCount,
      timerCount: options.renderer?.timerCount,
      listenerCount: options.renderer?.listenerCount,
      screenShareActive: options.renderer?.screenShare?.active ?? false,
      screenFallbackActive,
    },
    queues: {},
    flightRecorder: options.flightRecorder.snapshot(),
  };

  options.flightRecorder.record({
    source: "main",
    level: "debug",
    event: "runtime_health_snapshot",
    metrics: {
      peerCount: snapshot.realtime.peerCount,
      reconnectAttempts: snapshot.realtime.reconnectAttempts,
      mainWorkingSetBytes: snapshot.main.workingSetBytes ?? null,
      rendererWorkingSetBytes: snapshot.renderer?.workingSetBytes ?? null,
      actualFps: snapshot.rendererPerformance?.actualFps ?? null,
      displayRefreshRateHz: snapshot.display.refreshRateHz ?? null,
    },
  });
  snapshot.flightRecorder = options.flightRecorder.snapshot();
  return snapshot;
};
