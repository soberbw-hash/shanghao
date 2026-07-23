import type { IceCandidatePayload, SessionDescriptionPayload } from "@private-voice/signaling";

export interface MeshPeerOptions {
  peerId: string;
  localStream: MediaStream;
  iceServers?: RTCIceServer[];
  onIceCandidate: (candidate: IceCandidatePayload) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onDiagnosticEvent?: (
    event:
      | "connection_state"
      | "ice_connection_state"
      | "ice_gathering_state"
      | "ice_candidate_queue"
      | "network_adaptation",
    context: Record<string, unknown>,
  ) => void;
}

export interface ScreenShareEncodingProfile {
  maxBitrate: number;
  maxFramerate: number;
  maxWidth: number;
  maxHeight: number;
}

export interface NetworkAdaptationSample {
  packetLossPercent?: number;
  roundTripTimeMs?: number;
  jitterMs?: number;
  availableOutgoingBitrateBps?: number;
}

export type NetworkAdaptationTier = "healthy" | "constrained" | "critical";

interface NetworkTierProfile {
  audioBitrate: number;
  screenBitrateScale: number;
  screenMaxFramerate: number;
  screenScaleResolutionDownBy: number;
}

const NETWORK_TIER_PROFILES: Record<NetworkAdaptationTier, NetworkTierProfile> = {
  healthy: {
    audioBitrate: 24_000,
    screenBitrateScale: 1,
    screenMaxFramerate: 30,
    screenScaleResolutionDownBy: 1,
  },
  constrained: {
    audioBitrate: 20_000,
    screenBitrateScale: 0.72,
    screenMaxFramerate: 13,
    screenScaleResolutionDownBy: 1.25,
  },
  critical: {
    audioBitrate: 16_000,
    screenBitrateScale: 0.48,
    screenMaxFramerate: 10,
    screenScaleResolutionDownBy: 1.6,
  },
};

const NETWORK_TIER_SEVERITY: Record<NetworkAdaptationTier, number> = {
  healthy: 0,
  constrained: 1,
  critical: 2,
};

const OPUS_FMTP_PARAMETERS = [
  "minptime=10",
  "useinbandfec=1",
  "usedtx=1",
  "stereo=0",
  "sprop-stereo=0",
  "maxaveragebitrate=24000",
  "maxplaybackrate=32000",
  "sprop-maxcapturerate=32000",
];

export const tuneOpusSdp = (sdp?: string): string | undefined => {
  if (!sdp) return sdp;
  const lineBreak = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(lineBreak);
  const opusLineIndex = lines.findIndex((line) => {
    const normalized = line.trim().toLowerCase();
    const separatorIndex = normalized.indexOf(" ");
    return (
      normalized.startsWith("a=rtpmap:") &&
      separatorIndex > "a=rtpmap:".length &&
      normalized.slice(separatorIndex + 1).startsWith("opus/48000")
    );
  });
  if (opusLineIndex < 0) return sdp;

  const opusLine = lines[opusLineIndex];
  if (!opusLine) return sdp;
  const payloadType = opusLine.trim().slice("a=rtpmap:".length).split(" ", 1)[0]?.trim();
  if (!payloadType || [...payloadType].some((value) => value < "0" || value > "9")) return sdp;

  const fmtpPrefix = `a=fmtp:${payloadType}`;
  const fmtpLineIndex = lines.findIndex((line) => {
    const normalized = line.trim();
    return (
      normalized.startsWith(fmtpPrefix) &&
      (normalized.length === fmtpPrefix.length || normalized[fmtpPrefix.length] === " ")
    );
  });
  const retainedParameters = (
    fmtpLineIndex >= 0 ? (lines[fmtpLineIndex]?.trim().slice(fmtpPrefix.length) ?? "") : ""
  )
    .trim()
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(
      (value) =>
        !OPUS_FMTP_PARAMETERS.some((parameter) => parameter.split("=")[0] === value.split("=")[0]),
    );
  const nextFmtp = [...retainedParameters, ...OPUS_FMTP_PARAMETERS].join(";");

  if (fmtpLineIndex >= 0) {
    lines[fmtpLineIndex] = `${fmtpPrefix} ${nextFmtp}`;
  } else {
    lines.splice(opusLineIndex + 1, 0, `${fmtpPrefix} ${nextFmtp}`);
  }
  return lines.join(lineBreak);
};

export const selectNetworkTier = (sample: NetworkAdaptationSample): NetworkAdaptationTier => {
  const packetLoss = sample.packetLossPercent ?? 0;
  const roundTripTime = sample.roundTripTimeMs ?? 0;
  const jitter = sample.jitterMs ?? 0;
  const availableOutgoingBitrate =
    typeof sample.availableOutgoingBitrateBps === "number" && sample.availableOutgoingBitrateBps > 0
      ? sample.availableOutgoingBitrateBps
      : Number.POSITIVE_INFINITY;
  if (
    packetLoss >= 8 ||
    roundTripTime >= 420 ||
    jitter >= 90 ||
    availableOutgoingBitrate < 100_000
  ) {
    return "critical";
  }
  if (
    packetLoss >= 3 ||
    roundTripTime >= 220 ||
    jitter >= 45 ||
    availableOutgoingBitrate < 240_000
  ) {
    return "constrained";
  }
  return "healthy";
};

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
  private networkAdaptationTier: NetworkAdaptationTier = "healthy";
  private pendingRecoveryTier?: NetworkAdaptationTier;
  private pendingRecoverySamples = 0;

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
    const tunedOffer: RTCSessionDescriptionInit = {
      type: offer.type,
      sdp: tuneOpusSdp(offer.sdp),
    };
    await this.connection.setLocalDescription(tunedOffer);
    await this.configureOutgoingSenders();
    return {
      type: tunedOffer.type,
      sdp: tunedOffer.sdp,
    };
  }

  async acceptOffer(offer: SessionDescriptionPayload): Promise<SessionDescriptionPayload> {
    await this.connection.setRemoteDescription({
      type: offer.type,
      sdp: offer.sdp ?? undefined,
    });
    await this.flushPendingIceCandidates();
    const answer = await this.connection.createAnswer();
    const tunedAnswer: RTCSessionDescriptionInit = {
      type: answer.type,
      sdp: tuneOpusSdp(answer.sdp),
    };
    await this.connection.setLocalDescription(tunedAnswer);
    await this.configureOutgoingSenders();

    return {
      type: tunedAnswer.type,
      sdp: tunedAnswer.sdp,
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
      await nextTrack
        .applyConstraints({
          width: { max: profile.maxWidth },
          height: { max: profile.maxHeight },
          frameRate: {
            ideal: Math.max(10, profile.maxFramerate - 3),
            max: profile.maxFramerate,
          },
        })
        .catch(() => undefined);
      await this.configureScreenSender(profile);
    }
  }

  async adaptToNetwork(sample: NetworkAdaptationSample): Promise<NetworkAdaptationTier> {
    const measuredTier = selectNetworkTier(sample);
    const isDegrading =
      NETWORK_TIER_SEVERITY[measuredTier] > NETWORK_TIER_SEVERITY[this.networkAdaptationTier];

    if (measuredTier === this.networkAdaptationTier) {
      this.pendingRecoveryTier = undefined;
      this.pendingRecoverySamples = 0;
      return this.networkAdaptationTier;
    }

    if (!isDegrading) {
      if (this.pendingRecoveryTier !== measuredTier) {
        this.pendingRecoveryTier = measuredTier;
        this.pendingRecoverySamples = 1;
        return this.networkAdaptationTier;
      }
      this.pendingRecoverySamples += 1;
      if (this.pendingRecoverySamples < 3) return this.networkAdaptationTier;
    }

    const previousTier = this.networkAdaptationTier;
    this.networkAdaptationTier = measuredTier;
    this.pendingRecoveryTier = undefined;
    this.pendingRecoverySamples = 0;
    await this.configureOutgoingSenders();
    this.options.onDiagnosticEvent?.("network_adaptation", {
      peerId: this.options.peerId,
      previousTier,
      tier: measuredTier,
      ...sample,
    });
    return measuredTier;
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
    this.options.onRemoteStream(this.remoteStream);
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
      encoding.maxBitrate = NETWORK_TIER_PROFILES[this.networkAdaptationTier].audioBitrate;
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
      const networkProfile = NETWORK_TIER_PROFILES[this.networkAdaptationTier];
      encoding.maxBitrate = Math.round(profile.maxBitrate * networkProfile.screenBitrateScale);
      encoding.maxFramerate = Math.min(profile.maxFramerate, networkProfile.screenMaxFramerate);
      encoding.scaleResolutionDownBy = networkProfile.screenScaleResolutionDownBy;
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
