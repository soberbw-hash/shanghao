import { writeRendererLog } from "../../utils/logger";

/** Owns the short-lived Web Audio graph used while sharing system audio. */
export class ScreenAudioMixer {
  private context?: AudioContext;
  private mixedTrack?: MediaStreamTrack;
  private revision = 0;

  hasActiveMix(): boolean {
    return Boolean(this.mixedTrack);
  }

  async mix(
    microphoneTrack: MediaStreamTrack,
    systemAudioTrack: MediaStreamTrack,
    connect?: (track: MediaStreamTrack) => Promise<void>,
  ): Promise<MediaStreamTrack | undefined> {
    const revision = ++this.revision;
    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: "interactive", sampleRate: 32_000 });
    } catch {
      context = new AudioContext({ latencyHint: "interactive" });
    }

    let preparedTrack: MediaStreamTrack | undefined;
    try {
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
      preparedTrack = mixedTrack;
      if (!mixedTrack) {
        await context.close();
        return undefined;
      }

      mixedTrack.contentHint = "speech";
      // Keep the previous graph alive until every sender accepts the replacement.
      await connect?.(mixedTrack);
      if (revision !== this.revision) throw new Error("screen_audio_mix_superseded");
      this.dispose();
      this.context = context;
      this.mixedTrack = mixedTrack;
      void writeRendererLog("audio", "info", "Screen system audio mixed with microphone", {
        contextSampleRate: context.sampleRate,
        systemTrackLabel: systemAudioTrack.label,
      });
      return mixedTrack;
    } catch (error) {
      preparedTrack?.stop();
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  dispose(): void {
    this.revision++;
    this.mixedTrack?.stop();
    this.mixedTrack = undefined;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = undefined;
    }
  }
}
