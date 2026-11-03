import workletUrl from "./voiceReplay.worklet.js?url";
import { VoiceReplaySession } from "./voiceReplaySession";
import type { ReplayStateMessage } from "@private-voice/signaling";

/** Read-only tap: never stops, clones, or changes the room-owned call tracks. */
export class VoiceReplayCapture {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private readonly sources: MediaStreamAudioSourceNode[] = [];
  private session?: VoiceReplaySession;
  private closed = false;
  private gap = false;
  private lastFrameAt = 0;
  constructor(
    private readonly consent: NonNullable<ReplayStateMessage["state"]>,
    private readonly permitted: () => boolean,
  ) {}

  async start(microphone: MediaStreamTrack, remote: MediaStream): Promise<void> {
    if (this.closed) throw Error("voice_replay_closed");
    if (!this.consent.enabled || !this.permitted()) throw Error("voice_replay_not_authorized");
    const context = (this.context = new AudioContext({
      sampleRate: 48000,
      latencyHint: "playback",
    }));
    try {
      await context.audioWorklet.addModule(workletUrl);
      if (this.closed || !this.permitted()) throw Error("voice_replay_closed");
      const session = (this.session = new VoiceReplaySession(context.sampleRate));
      const epoch = session.updateMembers(this.consent.members);
      for (const id of this.consent.approved) session.approve(id, epoch);
      const node = (this.node = new AudioWorkletNode(context, "shanghao-voice-replay", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      }));
      node.port.onmessage = ({ data }: MessageEvent<Float32Array | string>) => {
        if (!this.closed && this.permitted()) {
          // Clear after a dropped PCM block rather than saving a falsely contiguous timeline.
          if (data === "gap") this.gap = true;
          else if (data instanceof Float32Array && data.length === 4096) {
            const now = performance.now();
            if (this.gap || (this.lastFrameAt && now - this.lastFrameAt > 1000))
              this.resetHistory();
            this.gap = false;
            this.lastFrameAt = now;
            this.session?.append(data);
          }
        } else this.close();
        if (data instanceof Float32Array) {
          data.fill(0);
          node.port.postMessage("ack");
        }
      };
      const streams = [new MediaStream([microphone]), remote];
      streams.forEach((stream, index) => {
        const source = context.createMediaStreamSource(stream);
        source.connect(node, 0, index);
        this.sources.push(source);
      });
      node.connect(context.destination);
      await context.resume();
      if (this.closed || !this.permitted()) throw Error("voice_replay_closed");
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private resetHistory(): void {
    this.session?.close();
    const session = (this.session = new VoiceReplaySession(this.context!.sampleRate));
    const epoch = session.updateMembers(this.consent.members);
    for (const id of this.consent.approved) session.approve(id, epoch);
  }
  snapshot(seconds: 15 | 30 | 60): Uint8Array {
    if (this.closed || !this.permitted() || !this.session)
      throw Error("voice_replay_not_authorized");
    if (this.gap || !this.lastFrameAt || performance.now() - this.lastFrameAt > 1000)
      throw Error("voice_replay_audio_stale");
    return this.session.snapshot(seconds);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.session?.close();
    this.session = undefined;
    for (const source of this.sources) source.disconnect();
    this.sources.length = 0;
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.postMessage("stop");
      this.node.disconnect();
      this.node.port.close();
    }
    void this.context?.close().catch(() => undefined);
  }
}
