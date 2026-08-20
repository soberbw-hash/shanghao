import type { SignalEnvelope } from "@private-voice/signaling";
import type { RealtimeFaultCommand, SignalingEventPayload } from "@private-voice/shared";

export class SignalingBridge {
  readonly sessionId = crypto.randomUUID();
  private unsubscribe?: () => void;
  private eventQueue: Promise<void> = Promise.resolve();

  async connect(
    url: string,
    onEvent: (payload: SignalingEventPayload) => Promise<void>,
    onFailure: (error: unknown) => void,
  ): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = window.desktopApi.signaling.onEvent((payload) => {
      if (payload.sessionId !== this.sessionId) return;
      this.eventQueue = this.eventQueue.then(() => onEvent(payload)).catch(onFailure);
    });
    await window.desktopApi.signaling.connect(url, this.sessionId);
  }

  async send(payload: SignalEnvelope): Promise<void> {
    await window.desktopApi.signaling.send(JSON.stringify(payload), this.sessionId);
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.eventQueue = Promise.resolve();
    await window.desktopApi.signaling.close(this.sessionId).catch(() => undefined);
  }

  async injectFault(command: RealtimeFaultCommand): Promise<void> {
    await window.desktopApi.signaling.injectFault(this.sessionId, command);
  }
}
