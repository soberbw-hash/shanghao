import { MicPermissionState, type LocalAudioDiagnostics } from "@private-voice/shared";
import { PhoneMicUsbReceiver } from "./phoneMicUsbReceiver";

export const PHONE_MIC_DEVICE_ID = "shanghao:phone-microphone";
export type PhoneMicMode = "wifi" | "web" | "usb";

export interface PhoneMicMetrics {
  latencyMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
  packetsReceived?: number;
  packetsLost?: number;
  bitrateKbps?: number;
  quality: "优秀" | "良好" | "一般" | "较差" | "等待连接";
}

export interface PhoneMicState {
  status: "idle" | "pairing" | "connected" | "streaming" | "disconnected" | "error";
  phase?: "authorizing" | "connecting" | "waitingForPhone" | "negotiating" | "recovering";
  mode: PhoneMicMode;
  pairingUrl?: string;
  error?: string;
  metrics: PhoneMicMetrics;
}

type PhoneMicListener = (state: PhoneMicState, stream?: MediaStream) => void;

const readablePhoneMicError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error|TypeError): /,
    "",
  );

const qualityFromMetrics = (
  latencyMs?: number,
  jitterMs?: number,
  packetLossPercent?: number,
): PhoneMicMetrics["quality"] => {
  if (latencyMs === undefined && jitterMs === undefined) return "等待连接";
  if ((packetLossPercent ?? 0) >= 5 || (jitterMs ?? 0) >= 80) return "较差";
  if ((packetLossPercent ?? 0) >= 2 || (jitterMs ?? 0) >= 45) return "一般";
  if ((packetLossPercent ?? 0) >= 0.5 || (jitterMs ?? 0) >= 20 || (latencyMs ?? 0) >= 150)
    return "良好";
  return "优秀";
};

export const phoneMicSignalingUrl = (relayUrl: string): URL => {
  const result = new URL(relayUrl);
  if (result.protocol === "http:") result.protocol = "ws:";
  if (result.protocol === "https:") result.protocol = "wss:";
  if (result.protocol !== "ws:" && result.protocol !== "wss:") {
    throw new Error("手机麦克风需要有效的中继地址");
  }
  // Public phone browsers need a trusted secure origin. The existing relay may still
  // be configured as ws://IP:43821 for the desktop app; its HTTPS proxy uses 443.
  if (result.protocol === "ws:" && !["localhost", "127.0.0.1"].includes(result.hostname)) {
    result.protocol = "wss:";
    result.port = "";
  }
  result.pathname = "/phone-mic/ws";
  result.search = "";
  result.hash = "";
  return result;
};

export class PhoneMicSource {
  private socket?: WebSocket;
  private peer?: RTCPeerConnection;
  private stream?: MediaStream;
  private usbReceiver?: PhoneMicUsbReceiver;
  private metricsTimer?: number;
  private pairingTimer?: number;
  private listeners = new Set<PhoneMicListener>();
  private iceServers: RTCIceServer[] = [];
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private lastReceived = 0;
  private lastLost = 0;
  private lastBytes = 0;
  private lastMetricsAt = 0;
  private disposed = false;
  private transition: Promise<void> = Promise.resolve();
  private state: PhoneMicState = {
    status: "idle",
    mode: "web",
    metrics: { quality: "等待连接" },
  };

  getState(): PhoneMicState {
    return { ...this.state, metrics: { ...this.state.metrics } };
  }

  getStream(): MediaStream | undefined {
    return this.stream;
  }

  getDiagnostics(): LocalAudioDiagnostics {
    const track = this.stream?.getAudioTracks()[0];
    const settings = track?.getSettings() ?? {};
    return {
      requestedSampleRate: 48_000,
      actualSampleRate: settings.sampleRate,
      actualChannelCount: settings.channelCount,
      permissionState: MicPermissionState.Granted,
      // Browser-side constraints are requested off; actual settings are reported by
      // the phone separately, so never assert that the remote browser obeyed them.
      echoCancellation: undefined,
      noiseSuppression: undefined,
      autoGainControl: undefined,
    };
  }

  subscribe(listener: PhoneMicListener): () => void {
    this.listeners.add(listener);
    listener(this.getState(), this.stream);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<PhoneMicState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.getState(), this.stream);
  }

  start(relayUrl: string, mode: PhoneMicMode, usbSerial?: string): Promise<void> {
    const operation = this.transition.then(() => this.startInternal(relayUrl, mode, usbSerial));
    this.transition = operation.catch(() => undefined);
    return operation;
  }

  private async startInternal(
    relayUrl: string,
    mode: PhoneMicMode,
    usbSerial?: string,
  ): Promise<void> {
    await this.stopInternal();
    this.disposed = false;
    this.publish({
      status: "pairing",
      phase: mode === "usb" ? "connecting" : "authorizing",
      mode,
      pairingUrl: undefined,
      error: undefined,
    });
    if (mode === "usb") {
      await this.startUsb(usbSerial);
      return;
    }
    let url: URL;
    try {
      url = phoneMicSignalingUrl(relayUrl);
    } catch (error) {
      this.publish({ status: "error", phase: undefined, error: readablePhoneMicError(error) });
      throw error;
    }
    const page = new URL(url.href);
    page.protocol = url.protocol === "wss:" ? "https:" : "http:";
    page.pathname = "/phone-mic";
    let ticket: string;
    try {
      ticket = await window.desktopApi.audio.getPhoneMicHostTicket(relayUrl);
    } catch (error) {
      this.publish({ status: "error", phase: undefined, error: readablePhoneMicError(error) });
      throw error;
    }
    this.publish({ phase: "connecting" });
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.publish({ status: "error", phase: undefined, error: readablePhoneMicError(error) });
      throw error;
    }
    this.socket = socket;
    this.pairingTimer = window.setTimeout(() => {
      if (this.socket !== socket || this.disposed || this.state.pairingUrl) return;
      this.publish({
        status: "error",
        phase: undefined,
        error: "配对服务响应超时，请检查服务器手机麦克风服务并重试。",
      });
      socket.close();
    }, 10_000);
    socket.onopen = () => this.send({ type: "create", ticket });
    socket.onmessage = (event) => {
      void this.handleSignal(event.data, page).catch((error: unknown) => {
        if (!this.disposed) {
          this.publish({
            status: "error",
            phase: undefined,
            error: error instanceof Error ? error.message : "音频连接协商失败",
          });
        }
      });
    };
    socket.onerror = () => {
      if (!this.disposed)
        this.publish({
          status: "error",
          phase: undefined,
          error: "配对服务连接失败，请检查中继和 HTTPS。",
        });
    };
    socket.onclose = () => {
      this.clearPairingTimer();
      if (this.disposed) return;
      this.closePeer();
      if (this.state.status === "error") return;
      if (!this.state.pairingUrl) {
        this.publish({
          status: "error",
          phase: undefined,
          error: "配对服务在生成二维码前断开，请检查服务器手机麦克风服务。",
        });
        return;
      }
      this.publish({
        status: "disconnected",
        phase: undefined,
        pairingUrl: undefined,
        error: "连接已断开，请重新配对。",
      });
    };
  }

  private async startUsb(serial?: string): Promise<void> {
    try {
      const session = await window.desktopApi.audio.startPhoneMicUsb(serial);
      if (this.disposed) {
        await window.desktopApi.audio.stopPhoneMicUsb();
        return;
      }
      this.publish({ pairingUrl: session.url });
      const receiver = new PhoneMicUsbReceiver();
      this.usbReceiver = receiver;
      const stream = await receiver.start(session.receiverUrl, (connected, counts) => {
        if (this.disposed || this.usbReceiver !== receiver) return;
        if (counts) {
          const total = counts.received + counts.lost;
          this.publish({
            metrics: {
              packetsReceived: counts.received,
              packetsLost: counts.lost,
              packetLossPercent: total > 0 ? (counts.lost / total) * 100 : 0,
              quality: connected ? "优秀" : "等待连接",
            },
          });
        }
        if (connected) {
          this.stream = receiver.getStream();
          this.publish({ status: "streaming", phase: undefined, error: undefined });
        } else if (this.state.status === "streaming") {
          this.publish({
            status: "connected",
            phase: undefined,
            error: "手机音频已断开，等待重新连接。",
          });
        }
      });
      if (this.disposed) {
        await receiver.stop();
        return;
      }
      // The stream exists before transmission, but is exposed only when the
      // sender actually connects so the room does not select a silent mic.
      if (this.state.status === "streaming") this.stream = stream;
    } catch (error) {
      await this.stopInternal();
      this.publish({
        status: "error",
        phase: undefined,
        error: error instanceof Error ? error.message : "USB 连接失败",
      });
      throw error;
    }
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async handleSignal(data: string, page: URL): Promise<void> {
    if (this.disposed) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === "created") {
      const sessionId = String(message.sessionId ?? "");
      const secret = String(message.pairingSecret ?? "");
      if (!sessionId || !secret) return;
      this.clearPairingTimer();
      this.iceServers = Array.isArray(message.iceServers)
        ? (message.iceServers as RTCIceServer[])
        : [];
      page.hash = new URLSearchParams({ id: sessionId, code: secret }).toString();
      this.publish({ status: "pairing", phase: "waitingForPhone", pairingUrl: page.href });
    } else if (message.type === "phone_connected") {
      this.publish({ status: "connected", phase: "negotiating", error: undefined });
    } else if (message.type === "phone_disconnected" || message.type === "phone_stopped") {
      this.closePeer();
      this.publish({
        status: "connected",
        phase: "recovering",
        // The original pairing secret was consumed on first join. Showing its
        // old QR code would promise a new phone can use it when it cannot.
        pairingUrl: undefined,
        error:
          message.type === "phone_disconnected"
            ? "手机已断开，请在 60 秒内用原手机重连；换手机请点重试连接。"
            : "手机已停止传输，可在原手机重新开始；换手机请点重试连接。",
        metrics: { quality: "等待连接" },
      });
    } else if (message.type === "offer" && typeof message.sdp === "string") {
      await this.acceptOffer(message.sdp);
    } else if (message.type === "candidate" && message.candidate) {
      const candidate = message.candidate as RTCIceCandidateInit;
      if (!this.peer?.remoteDescription) this.pendingCandidates.push(candidate);
      else {
        try {
          await this.peer.addIceCandidate(candidate);
        } catch {
          /* Stale candidate from a previous ICE generation. */
        }
      }
    }
  }

  private async acceptOffer(sdp: string): Promise<void> {
    const earlyCandidates = this.pendingCandidates.splice(0);
    this.closePeer();
    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peer = peer;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: "candidate", candidate });
    };
    peer.ontrack = ({ track, streams }) => {
      if (track.kind !== "audio" || this.peer !== peer) return;
      this.stream = streams[0] ?? new MediaStream([track]);
      track.addEventListener(
        "ended",
        () => {
          if (this.peer === peer) {
            this.closePeer();
            this.publish({
              status: "connected",
              phase: "negotiating",
              error: "手机音频已停止。",
            });
          }
        },
        { once: true },
      );
      this.publish({ status: "streaming", phase: undefined, error: undefined });
      this.metricsTimer = window.setInterval(() => void this.sampleMetrics(peer), 1_000);
    };
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return;
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        this.closePeer();
        this.publish({
          status: "connected",
          phase: "negotiating",
          error: "音频连接中断，等待手机重连。",
        });
      }
    };
    await peer.setRemoteDescription({ type: "offer", sdp });
    for (const candidate of [...earlyCandidates, ...this.pendingCandidates.splice(0)]) {
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        /* A candidate may belong to a replaced offer. */
      }
    }
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    this.send({ type: "answer", sdp: answer.sdp });
  }

  private async sampleMetrics(peer: RTCPeerConnection): Promise<void> {
    if (peer !== this.peer) return;
    const reports = await peer.getStats();
    for (const stat of reports.values()) {
      if (stat.type !== "inbound-rtp" || stat.kind !== "audio") continue;
      const now = performance.now();
      const bytes = Number(stat.bytesReceived ?? 0);
      const bitrateKbps = this.lastMetricsAt
        ? ((bytes - this.lastBytes) * 8) / (now - this.lastMetricsAt)
        : undefined;
      this.lastBytes = bytes;
      this.lastMetricsAt = now;
      const received = Number(stat.packetsReceived ?? 0);
      const lost = Number(stat.packetsLost ?? 0);
      const recentReceived = received - this.lastReceived;
      const recentLost = Math.max(0, lost - this.lastLost);
      this.lastReceived = received;
      this.lastLost = lost;
      const jitterMs = Number(stat.jitter ?? 0) * 1_000;
      const packetLossPercent =
        recentReceived + recentLost > 0 ? (recentLost / (recentReceived + recentLost)) * 100 : 0;
      let latencyMs: number | undefined;
      if (stat.remoteId) {
        const remote = reports.get(stat.remoteId);
        if (remote?.roundTripTime !== undefined) latencyMs = remote.roundTripTime * 1_000;
      }
      this.publish({
        metrics: {
          latencyMs,
          jitterMs,
          packetLossPercent,
          packetsReceived: received,
          packetsLost: lost,
          bitrateKbps,
          quality: qualityFromMetrics(latencyMs, jitterMs, packetLossPercent),
        },
      });
      break;
    }
  }

  private closePeer(): void {
    if (this.metricsTimer !== undefined) window.clearInterval(this.metricsTimer);
    this.metricsTimer = undefined;
    this.peer?.close();
    this.peer = undefined;
    this.stream = undefined;
    this.lastReceived = 0;
    this.lastLost = 0;
    this.lastBytes = 0;
    this.lastMetricsAt = 0;
    this.pendingCandidates = [];
  }

  stop(): Promise<void> {
    const operation = this.transition.then(() => this.stopInternal());
    this.transition = operation.catch(() => undefined);
    return operation;
  }

  private async stopInternal(): Promise<void> {
    this.disposed = true;
    this.clearPairingTimer();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = undefined;
    }
    this.closePeer();
    if (this.usbReceiver) {
      const receiver = this.usbReceiver;
      this.usbReceiver = undefined;
      await receiver.stop();
      await window.desktopApi.audio.stopPhoneMicUsb();
    }
    this.publish({
      status: "idle",
      phase: undefined,
      pairingUrl: undefined,
      error: undefined,
      metrics: { quality: "等待连接" },
    });
  }

  private clearPairingTimer(): void {
    if (this.pairingTimer !== undefined) window.clearTimeout(this.pairingTimer);
    this.pairingTimer = undefined;
  }
}

export const phoneMicSource = new PhoneMicSource();
