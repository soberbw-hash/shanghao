import { writeRendererLog } from "../../utils/logger";

/** Owns the short-lived Web Audio graph used while sharing system audio. */
export class ScreenAudioMixer {
  private context?: AudioContext;
  private mixedTrack?: MediaStreamTrack;

  hasActiveMix(): boolean {
    return Boolean(this.mixedTrack);
  }

  async mix(
    microphoneTrack: MediaStreamTrack,
    systemAudioTrack: MediaStreamTrack,
  ): Promise<MediaStreamTrack | undefined> {
    this.dispose();

    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: "interactive", sampleRate: 32_000 });
    } catch {
      context = new AudioContext({ latencyHint: "interactive" });
    }

    const destination = context.createMediaStreamDestination();
    const microphoneSource = context.createMediaStreamSource(new MediaStream([microphoneTrack]));
    const systemSource = context.createMediaStreamSource(new MediaStream([systemAudioTrack]));
    const microphoneGain = context.createGain();
    const systemGain = context.createGain();
    microphoneGain.gain.value = 1;
    systemGain.gain.value = 0.72;
    microphoneSource.connect(microphoneGain).connect(destination);
    systemSource.connect(systemGain).connect(destination);

    const mixedTrack = destination.stream.getAudioTracks()[0];
    if (!mixedTrack) {
      await context.close();
      return undefined;
    }

    mixedTrack.contentHint = "speech";
    this.context = context;
    this.mixedTrack = mixedTrack;
    void writeRendererLog("audio", "info", "Screen system audio mixed with microphone", {
      contextSampleRate: context.sampleRate,
      systemTrackLabel: systemAudioTrack.label,
    });
    return mixedTrack;
  }

  dispose(): void {
    this.mixedTrack?.stop();
    this.mixedTrack = undefined;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = undefined;
    }
  }
}
