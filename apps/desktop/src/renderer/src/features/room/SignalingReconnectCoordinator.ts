import { DEFAULT_RECONNECT_DELAYS_MS } from "@private-voice/shared";
import { ExponentialBackoff } from "@private-voice/webrtc";
import { writeRendererLog } from "../../utils/logger";

export const RECONNECT_STABLE_WINDOW_MS = 3_000;

interface ReconnectScheduleContext {
  attempt: number;
  delay: number;
}

interface ReconnectFailureContext {
  attempt: number;
  error: unknown;
}

interface SignalingReconnectCoordinatorOptions {
  onAttempt?: (attempt: number) => void;
  onSchedule?: (context: ReconnectScheduleContext) => void;
  onFailure?: (context: ReconnectFailureContext) => void;
  onStable?: (episodeId: number) => void;
}

export class SignalingReconnectCoordinator {
  private readonly backoff = new ExponentialBackoff(DEFAULT_RECONNECT_DELAYS_MS);
  private reconnectTimer?: number;
  private stableTimer?: number;
  private attempts = 0;
  private episodeSequence = 0;
  private activeEpisodeId?: number;
  private stableSince?: string;

  constructor(private readonly options: SignalingReconnectCoordinatorOptions = {}) {}

  getSnapshot() {
    return {
      attempts: this.attempts,
      episodeId: this.activeEpisodeId,
      episodeActive: this.activeEpisodeId !== undefined,
      stableSince: this.stableSince,
      reconnectPending: this.reconnectTimer !== undefined,
    };
  }

  beginEpisode(): number {
    this.cancelStableWindow();
    this.activeEpisodeId ??= ++this.episodeSequence;
    return this.activeEpisodeId;
  }

  schedule(openSocket: () => Promise<void>, shouldContinue: () => boolean): void {
    if (this.reconnectTimer !== undefined) return;

    this.attempts += 1;
    const attempt = this.attempts;
    this.options.onAttempt?.(attempt);
    const baseDelay = this.backoff.nextDelay();
    const delay = baseDelay + Math.floor(Math.random() * Math.max(250, baseDelay * 0.16));
    this.options.onSchedule?.({ attempt, delay });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      void openSocket().catch((error) => {
        this.options.onFailure?.({ attempt, error });
        if (shouldContinue()) this.schedule(openSocket, shouldContinue);
      });
    }, delay);
  }

  beginStableWindow(isStable: () => boolean): void {
    this.cancelStableWindow();
    if (this.activeEpisodeId === undefined) {
      this.resetAttempts();
      return;
    }

    this.stableSince = new Date().toISOString();
    const episodeId = this.activeEpisodeId;
    this.stableTimer = window.setTimeout(() => {
      this.stableTimer = undefined;
      if (!isStable() || this.activeEpisodeId !== episodeId) return;
      this.resetAttempts();
      this.activeEpisodeId = undefined;
      this.options.onStable?.(episodeId);
    }, RECONNECT_STABLE_WINDOW_MS);
  }

  cancelStableWindow(): void {
    if (this.stableTimer !== undefined) {
      window.clearTimeout(this.stableTimer);
      this.stableTimer = undefined;
    }
    this.stableSince = undefined;
  }

  dispose(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.cancelStableWindow();
  }

  private resetAttempts(): void {
    this.backoff.reset();
    this.attempts = 0;
  }
}

export const createSignalingReconnectCoordinator = (context: {
  roomId: string;
  peerId: string;
  getConnectionGeneration: () => number | undefined;
  onAttempt?: (attempt: number) => void;
}) =>
  new SignalingReconnectCoordinator({
    onAttempt: context.onAttempt,
    onSchedule: ({ attempt, delay }) => {
      void writeRendererLog("signaling", "warn", "Scheduling signaling reconnect", {
        roomId: context.roomId,
        peerId: context.peerId,
        attempt,
        delay,
      });
    },
    onFailure: ({ attempt, error }) => {
      void writeRendererLog("signaling", "warn", "Signaling reconnect attempt failed", {
        roomId: context.roomId,
        peerId: context.peerId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onStable: (episodeId) => {
      void writeRendererLog(
        "signaling",
        "info",
        "Signaling reconnect episode reached stable window",
        {
          reconnectEpisodeId: episodeId,
          connectionGeneration: context.getConnectionGeneration(),
          stableWindowMs: RECONNECT_STABLE_WINDOW_MS,
        },
      );
    },
  });
