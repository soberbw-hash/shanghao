import type { RendererRuntimeHealthInput, RuntimeHealthSnapshot } from "@private-voice/shared";

import { phoneMicSource } from "../audio/phoneMicSource";
import { getRoomRuntimeDiagnostics } from "../../hooks/useRoomState";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { rendererPerformanceMonitor } from "./rendererPerformanceMonitor";

const BACKGROUND_INTERVAL_MS = 60_000;
const DIAGNOSTICS_INTERVAL_MS = 5_000;

export const sanitizeRuntimeServerUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return undefined;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return undefined;
  }
};

class RuntimeHealthCollector {
  private consumers = 0;
  private detailedConsumers = 0;
  private timer?: number;
  private inFlight?: Promise<RuntimeHealthSnapshot>;
  private latest?: RuntimeHealthSnapshot;
  private readonly listeners = new Set<(snapshot: RuntimeHealthSnapshot) => void>();
  private stopPerformanceMonitor?: () => void;
  private phaseId = 0;
  private shapeKey = "";

  start(): () => void {
    this.consumers += 1;
    if (this.consumers === 1) {
      window.addEventListener("shanghao:lifecycle-recovery", this.onLifecycleRecovery);
      this.schedule(0);
    }
    return () => {
      this.consumers = Math.max(0, this.consumers - 1);
      if (this.consumers > 0) return;
      window.removeEventListener("shanghao:lifecycle-recovery", this.onLifecycleRecovery);
      if (this.timer !== undefined) window.clearTimeout(this.timer);
      this.timer = undefined;
    };
  }

  observeDetailed(): () => void {
    this.detailedConsumers += 1;
    if (this.detailedConsumers === 1) {
      this.stopPerformanceMonitor = rendererPerformanceMonitor.start();
      this.schedule(0);
    }
    return () => {
      this.detailedConsumers = Math.max(0, this.detailedConsumers - 1);
      if (this.detailedConsumers > 0) return;
      this.stopPerformanceMonitor?.();
      this.stopPerformanceMonitor = undefined;
      this.schedule(BACKGROUND_INTERVAL_MS);
    };
  }

  snapshot(): RuntimeHealthSnapshot | undefined {
    return this.latest;
  }

  subscribe(listener: (snapshot: RuntimeHealthSnapshot) => void): () => void {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest);
    return () => this.listeners.delete(listener);
  }

  refresh(): Promise<RuntimeHealthSnapshot> {
    if (this.inFlight) return this.inFlight;
    const inFlight = this.capture().then((snapshot) => {
      this.latest = snapshot;
      for (const listener of this.listeners) listener(snapshot);
      return snapshot;
    });
    this.inFlight = inFlight.finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private readonly onLifecycleRecovery = (event: Event): void => {
    const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
    if (reason === "resume") {
      this.phaseId += 1;
      this.schedule(0);
    }
  };

  private schedule(delayMs: number): void {
    if (this.consumers === 0) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.refresh()
        .catch(() => undefined)
        .finally(() => {
          if (this.consumers > 0) {
            this.schedule(
              this.detailedConsumers > 0 ? DIAGNOSTICS_INTERVAL_MS : BACKGROUND_INTERVAL_MS,
            );
          }
        });
    }, delayMs);
  }

  private async capture(): Promise<RuntimeHealthSnapshot> {
    const runtime = getRoomRuntimeDiagnostics();
    const { room, localStream, remoteStreams } = useRoomStore.getState();
    const settings = useSettingsStore.getState().settings;
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
    };
    const screenShareActive = Boolean(
      runtime?.screenShare &&
      (runtime.screenShare.requested ||
        Object.keys(runtime.screenShare.receive).length ||
        runtime.screenShare.fallback.active),
    );
    const shapeKey = [
      room.roomId ?? "none",
      room.lifecycleState,
      runtime?.remotePeerCount ?? Object.keys(remoteStreams).length,
      screenShareActive,
      settings?.preferredInputDeviceId ?? "default-input",
      settings?.preferredOutputDeviceId ?? "default-output",
      localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? "no-input-track",
      phoneMicSource.getState().status,
    ].join("|");
    if (shapeKey !== this.shapeKey) {
      this.shapeKey = shapeKey;
      this.phaseId += 1;
    }
    const trackCount = [localStream, ...Object.values(remoteStreams)].reduce(
      (total, stream) =>
        total + (stream?.getTracks().filter((track) => track.readyState === "live").length ?? 0),
      0,
    );
    const mixer = runtime?.remoteAudioMixer;
    const input: RendererRuntimeHealthInput = {
      performance: rendererPerformanceMonitor.snapshot(),
      jsHeapUsedBytes: memory.memory?.usedJSHeapSize,
      jsHeapTotalBytes: memory.memory?.totalJSHeapSize,
      domNodeCount: document.getElementsByTagName("*").length,
      trackCount,
      phoneMicStatus: phoneMicSource.getState().status,
      audioNodeCount: mixer?.audioNodeCount,
      audioContextCount: mixer?.audioContextCount,
      timerCount: mixer?.timerCount,
      phaseId: this.phaseId,
      screenShare: runtime?.screenShare
        ? {
            active: screenShareActive,
            fallbackActive: runtime.screenShare.fallback.active,
            requestedWidth: runtime.screenShare.requested?.width,
            requestedHeight: runtime.screenShare.requested?.height,
            captureWidth: runtime.screenShare.capture?.width,
            captureHeight: runtime.screenShare.capture?.height,
            captureFps: runtime.screenShare.capture?.framesPerSecond,
          }
        : undefined,
      room: {
        roomLifecycleState: room.lifecycleState,
        roomConnectionState: room.connectionState,
        serverUrl: sanitizeRuntimeServerUrl(room.signalingUrl ?? settings?.relayServerUrl),
        currentRoomId: room.roomId,
        currentPeerId: runtime?.currentPeerId,
        reconnectAttempts: runtime?.reconnectAttempts ?? 0,
        connectionGeneration: runtime?.connectionGeneration,
        reconnectEpisodeId: runtime?.reconnectEpisodeId,
        reconnectEpisodeActive: runtime?.reconnectEpisodeActive,
        reconnectStableSince: runtime?.reconnectStableSince,
        activeClientExists: Boolean(runtime),
        audioRelayState: runtime?.audioRelayState ?? "inactive",
        localStreamActive: Boolean(
          localStream?.getAudioTracks().some((track) => track.readyState === "live"),
        ),
        remotePeerCount: runtime?.remotePeerCount ?? Object.keys(remoteStreams).length,
        screenShareRelayState: runtime?.screenShareRelayState,
        roomSnapshotRevision: runtime?.roomSnapshotRevision ?? 0,
        chatSendFailures: runtime?.chatSendFailures ?? 0,
      },
    };
    return window.desktopApi.diagnostics.runtimeHealth(input);
  }
}

export const runtimeHealthCollector = new RuntimeHealthCollector();
