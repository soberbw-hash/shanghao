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
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"],
  },
];

export class MeshPeerConnection {
  readonly connection: RTCPeerConnection;

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
      this.options.onConnectionStateChange?.(this.connection.connectionState);
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
  }

  async addIceCandidate(candidate: IceCandidatePayload): Promise<void> {
    await this.connection.addIceCandidate(candidate);
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
    this.connection.close();
  }
}
