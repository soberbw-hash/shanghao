import type {
  IceCandidatePayload,
  SessionDescriptionPayload,
} from "@private-voice/signaling";

export interface MeshPeerOptions {
  peerId: string;
  localStream: MediaStream;
  iceServers?: RTCIceServer[];
  onIceCandidate: (candidate: IceCandidatePayload) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onDiagnosticEvent?: (
    event: "connection_state" | "ice_connection_state" | "ice_gathering_state" | "ice_candidate_queue",
    context: Record<string, unknown>,
  ) => void;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.qq.com:3478" },
  { urls: "stun:stun.miwifi.com:3478" },
  { urls: "stun:stun.chat.bilibili.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

export class MeshPeerConnection {
  readonly connection: RTCPeerConnection;
  private readonly pendingIceCandidates: IceCandidatePayload[] = [];

  constructor(private readonly options: MeshPeerOptions) {
    this.connection = new RTCPeerConnection({
      iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS,
    });

    for (const track of options.localStream.getTracks()) {
      this.connection.addTrack(track, options.localStream);
    }

    this.connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.options.onIceCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      });
    };

    this.connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.options.onRemoteStream(stream);
      }
    };

    this.connection.onconnectionstatechange = () => {
      this.options.onDiagnosticEvent?.("connection_state", {
        peerId: this.options.peerId,
        state: this.connection.connectionState,
      });
      this.options.onConnectionStateChange?.(this.connection.connectionState);
    };

    this.connection.oniceconnectionstatechange = () => {
      this.options.onDiagnosticEvent?.("ice_connection_state", {
        peerId: this.options.peerId,
        state: this.connection.iceConnectionState,
      });
    };

    this.connection.onicegatheringstatechange = () => {
      this.options.onDiagnosticEvent?.("ice_gathering_state", {
        peerId: this.options.peerId,
        state: this.connection.iceGatheringState,
      });
    };
  }

  async createOffer(): Promise<SessionDescriptionPayload> {
    const offer = await this.connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await this.connection.setLocalDescription(offer);
    return {
      type: offer.type,
      sdp: offer.sdp,
    };
  }

  async acceptOffer(offer: SessionDescriptionPayload): Promise<SessionDescriptionPayload> {
    await this.connection.setRemoteDescription({
      type: offer.type,
      sdp: offer.sdp ?? undefined,
    });
    await this.flushPendingIceCandidates();
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);

    return {
      type: answer.type,
      sdp: answer.sdp,
    };
  }

  async acceptAnswer(answer: SessionDescriptionPayload): Promise<void> {
    await this.connection.setRemoteDescription({
      type: answer.type,
      sdp: answer.sdp ?? undefined,
    });
    await this.flushPendingIceCandidates();
  }

  async addIceCandidate(candidate: IceCandidatePayload): Promise<void> {
    if (!this.connection.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      this.options.onDiagnosticEvent?.("ice_candidate_queue", {
        peerId: this.options.peerId,
        action: "buffered",
        pendingCount: this.pendingIceCandidates.length,
      });
      return;
    }

    await this.addIceCandidateSafely(candidate);
  }

  async replaceLocalTrack(nextTrack: MediaStreamTrack): Promise<void> {
    const sender = this.connection
      .getSenders()
      .find((candidate) => candidate.track?.kind === "audio");

    if (sender) {
      await sender.replaceTrack(nextTrack);
    }
  }

  destroy(): void {
    this.pendingIceCandidates.length = 0;
    this.connection.close();
  }

  private async flushPendingIceCandidates(): Promise<void> {
    const candidates = this.pendingIceCandidates.splice(0);
    if (candidates.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      candidates.map((candidate) => this.addIceCandidateSafely(candidate)),
    );
    this.options.onDiagnosticEvent?.("ice_candidate_queue", {
      peerId: this.options.peerId,
      action: "flushed",
      candidateCount: candidates.length,
      failedCount: results.filter((result) => result.status === "rejected").length,
    });
  }

  private async addIceCandidateSafely(candidate: IceCandidatePayload): Promise<void> {
    try {
      await this.connection.addIceCandidate(candidate);
    } catch (error) {
      this.options.onDiagnosticEvent?.("ice_candidate_queue", {
        peerId: this.options.peerId,
        action: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
