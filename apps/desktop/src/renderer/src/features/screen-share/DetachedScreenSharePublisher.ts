import type { ScreenShareViewerSignal } from "@private-voice/shared";

interface DetachedScreenSharePublisherOptions {
  sessionId: string;
  title: string;
  stream: MediaStream;
  onClosed: () => void;
}

export class DetachedScreenSharePublisher {
  private readonly peer = new RTCPeerConnection({ iceServers: [] });
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private unsubscribe?: () => void;
  private hasOffered = false;
  private isDisposed = false;

  constructor(private readonly options: DetachedScreenSharePublisherOptions) {}

  start(): void {
    for (const track of this.options.stream.getVideoTracks()) {
      this.peer.addTrack(track, this.options.stream);
    }
    this.peer.onicecandidate = ({ candidate }) => {
      if (!candidate || this.isDisposed) return;
      const json = candidate.toJSON();
      void this.send({
        type: "ice",
        candidate: json.candidate,
        sdpMid: json.sdpMid,
        sdpMLineIndex: json.sdpMLineIndex,
      });
    };
    this.peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(this.peer.connectionState)) this.options.onClosed();
    };
    this.unsubscribe = window.desktopApi.screenShareViewer.onSignal((signal) => {
      if (signal.sessionId !== this.options.sessionId || signal.sender !== "viewer") return;
      void this.handleSignal(signal).catch(() => {
        if (!this.isDisposed) this.options.onClosed();
      });
    });

    // The viewer answers this handshake after its React effect is attached, so
    // opening the BrowserWindow and mounting the publisher cannot race.
    void this.send({ type: "ready" });
  }

  destroy(notifyViewer = false): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    if (notifyViewer) void this.send({ type: "closed" });
    this.unsubscribe?.();
    this.peer.onicecandidate = null;
    this.peer.onconnectionstatechange = null;
    this.peer.close();
  }

  private async handleSignal(signal: ScreenShareViewerSignal): Promise<void> {
    if (signal.type === "ready") {
      await this.createOffer();
      return;
    }
    if (signal.type === "closed") {
      this.options.onClosed();
      return;
    }
    if (signal.type === "answer" && signal.sdp) {
      await this.peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      await this.flushCandidates();
      return;
    }
    if (signal.type === "ice" && signal.candidate) {
      const candidate: RTCIceCandidateInit = {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid,
        sdpMLineIndex: signal.sdpMLineIndex,
      };
      if (this.peer.remoteDescription) await this.peer.addIceCandidate(candidate);
      else this.pendingCandidates.push(candidate);
    }
  }

  private async createOffer(): Promise<void> {
    if (this.hasOffered || this.isDisposed) return;
    this.hasOffered = true;
    try {
      const offer = await this.peer.createOffer();
      await this.peer.setLocalDescription(offer);
      await this.send({ type: "offer", sdp: offer.sdp });
    } catch {
      this.hasOffered = false;
      this.options.onClosed();
    }
  }

  private async flushCandidates(): Promise<void> {
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) await this.peer.addIceCandidate(candidate);
    }
  }

  private send(
    signal: Omit<ScreenShareViewerSignal, "sessionId" | "sender" | "title">,
  ): Promise<boolean> {
    return window.desktopApi.screenShareViewer
      .sendSignal({
        ...signal,
        sessionId: this.options.sessionId,
        sender: "host",
        title: this.options.title,
      })
      .catch(() => false);
  }
}
