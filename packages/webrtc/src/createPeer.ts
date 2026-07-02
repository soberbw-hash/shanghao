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

export interface ScreenShareEncodingProfile {
  maxBitrate: number;
  maxFramerate: number;
  maxWidth: number;
  maxHeight: number;
}

export const DEFAULT_SCREEN_SHARE_PROFILE: ScreenShareEncodingProfile = {
  maxBitrate: 420_000,
  maxFramerate: 15,
  maxWidth: 1_280,
  maxHeight: 720,
};

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.qq.com:3478" },
  { urls: "stun:stun.miwifi.com:3478" },
  { urls: "stun:stun.chat.bilibili.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

export class MeshPeerConnection {
  readonly connection: RTCPeerConnection;
  private readonly pendingIceCandidates: IceCandidatePayload[] = [];
  private readonly remoteStream = new MediaStream();
  private readonly screenTransceiver: RTCRtpTransceiver;
  private screenShareProfile = DEFAULT_SCREEN_SHARE_PROFILE;

  constructor(private readonly options: MeshPeerOptions) {
    this.connection = new RTCPeerConnection({
      iceServers: options.iceServers ?? DEFAULT_ICE_SERVERS,
    });

    for (const track of options.localStream.getTracks()) {
      this.connection.addTrack(track, options.localStream);
    }

    this.screenTransceiver = this.connection.addTransceiver("video", {
      direction: "sendrecv",
    });
    const audioSender = this.connection
      .getSenders()
      .find((candidate) => candidate.track?.kind === "audio");
    if (audioSender) {
      void this.configureAudioSender(audioSender);
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
      if (!this.remoteStream.getTracks().some((track) => track.id === event.track.id)) {
        this.remoteStream.addTrack(event.track);
      }

      event.track.onended = () => {
        this.remoteStream.removeTrack(event.track);
        this.publishRemoteStream();
      };
      event.track.onmute = () => this.publishRemoteStream();
      event.track.onunmute = () => this.publishRemoteStream();
      this.publishRemoteStream();
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
      offerToReceiveVideo: true,
    });
    await this.connection.setLocalDescription(offer);
    await this.configureOutgoingSenders();
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
    await this.configureOutgoingSenders();

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
    await this.configureOutgoingSenders();
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
      await this.configureAudioSender(sender);
    }
  }

  async setScreenTrack(
    nextTrack?: MediaStreamTrack,
    profile: ScreenShareEncodingProfile = DEFAULT_SCREEN_SHARE_PROFILE,
  ): Promise<void> {
    this.screenShareProfile = profile;
    await this.screenTransceiver.sender.replaceTrack(nextTrack ?? null);
    if (nextTrack) {
      nextTrack.contentHint = "detail";
      await nextTrack.applyConstraints({
        width: { max: profile.maxWidth },
        height: { max: profile.maxHeight },
        frameRate: {
          ideal: Math.max(10, profile.maxFramerate - 3),
          max: profile.maxFramerate,
        },
      }).catch(() => undefined);
      await this.configureScreenSender(profile);
    }
  }

  destroy(): void {
    this.pendingIceCandidates.length = 0;
    void this.screenTransceiver.sender.replaceTrack(null).catch(() => undefined);
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

  private publishRemoteStream(): void {
    this.options.onRemoteStream(new MediaStream(this.remoteStream.getTracks()));
  }

  private async configureAudioSender(sender: RTCRtpSender): Promise<void> {
    const track = sender.track;
    if (track) {
      track.contentHint = "speech";
    }
    try {
      const parameters = sender.getParameters();
      parameters.encodings ??= [{}];
      const encoding = parameters.encodings[0] as RTCRtpEncodingParameters & {
        dtx?: "enabled" | "disabled";
        networkPriority?: RTCPriorityType;
      };
      encoding.maxBitrate = 24_000;
      encoding.priority = "high";
      encoding.networkPriority = "high";
      encoding.dtx = "enabled";
      await sender.setParameters(parameters);
    } catch (error) {
      this.options.onDiagnosticEvent?.("connection_state", {
        peerId: this.options.peerId,
        state: this.connection.connectionState,
        audioSenderTuningError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async configureScreenSender(
    profile: ScreenShareEncodingProfile = DEFAULT_SCREEN_SHARE_PROFILE,
  ): Promise<void> {
    const sender = this.screenTransceiver.sender;
    try {
      const parameters = sender.getParameters();
      parameters.encodings ??= [{}];
      const encoding = parameters.encodings[0] as RTCRtpEncodingParameters & {
        networkPriority?: RTCPriorityType;
      };
      encoding.maxBitrate = profile.maxBitrate;
      encoding.maxFramerate = profile.maxFramerate;
      encoding.priority = "low";
      encoding.networkPriority = "low";
      await sender.setParameters(parameters);
    } catch (error) {
      this.options.onDiagnosticEvent?.("connection_state", {
        peerId: this.options.peerId,
        state: this.connection.connectionState,
        screenSenderTuningError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async configureOutgoingSenders(): Promise<void> {
    const audioSender = this.connection
      .getSenders()
      .find((candidate) => candidate.track?.kind === "audio");
    if (audioSender) {
      await this.configureAudioSender(audioSender);
    }
    if (this.screenTransceiver.sender.track) {
      await this.configureScreenSender(this.screenShareProfile);
    }
  }
}
