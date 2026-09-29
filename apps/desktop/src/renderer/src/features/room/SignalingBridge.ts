import type { SignalEnvelope } from "@private-voice/signaling";
import type { RealtimeFaultCommand, SignalingEventPayload } from "@private-voice/shared";

export class SignalingBridge {
  sessionId = crypto.randomUUID();
  private unsubscribe?: () => void;
  private eventQueue: Promise<void> = Promise.resolve();
  private connectionEpoch = 0;

  async connect(
    url: string,
    onEvent: (payload: SignalingEventPayload) => Promise<void>,
    onFailure: (error: unknown) => void,
  ): Promise<void> {
    const epoch = ++this.connectionEpoch;
    const sessionId = (this.sessionId = crypto.randomUUID());
    this.unsubscribe?.();
    this.eventQueue = Promise.resolve();
    this.unsubscribe = window.desktopApi.signaling.onEvent((payload) => {
      if (payload.sessionId !== sessionId || epoch !== this.connectionEpoch) return;
      this.eventQueue = this.eventQueue
        .then(() => (epoch === this.connectionEpoch ? onEvent(payload) : undefined))
        .catch((error) => {
          if (epoch === this.connectionEpoch) onFailure(error);
        });
    });
    await window.desktopApi.signaling.connect(url, sessionId);
  }

  async send(payload: SignalEnvelope): Promise<void> {
    await window.desktopApi.signaling.send(JSON.stringify(payload), this.sessionId);
  }

  async close(): Promise<void> {
    this.connectionEpoch += 1;
    const sessionId = this.sessionId;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.eventQueue = Promise.resolve();
    await window.desktopApi.signaling.close(sessionId).catch(() => undefined);
  }

  async injectFault(command: RealtimeFaultCommand): Promise<void> {
    await window.desktopApi.signaling.injectFault(this.sessionId, command);
  }
}
