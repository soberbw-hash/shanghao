import { writeRendererLog } from "../../utils/logger";
import { linkAudioSendGate } from "../audio/audioSendGate";

/** Owns the short-lived Web Audio graph used while sharing system audio. */
export class ScreenAudioMixer {
  private context?: AudioContext;
  private mixedTrack?: MediaStreamTrack;
  private revision = 0;
  private unlinkGate?: () => void;
  private applicationTrack?: MediaStreamTrack;
  hasApplicationAudio(): boolean {
    return this.applicationTrack?.readyState === "live";
  }

  async setApplicationTrack(
    track: MediaStreamTrack | undefined,
    microphone: MediaStreamTrack | undefined,
    screen: MediaStreamTrack | undefined,
    connect: (track: MediaStreamTrack) => Promise<void>,
  ): Promise<void> {
    if (!microphone) throw Error("microphone_missing");
    const previous = this.applicationTrack;
    this.applicationTrack = track;
    try {
      if (track || screen) await this.mix(microphone, screen, connect);
      else await this.restore(microphone, connect);
    } catch (error) {
      if (this.applicationTrack === track) this.applicationTrack = previous;
      throw error;
    }
  }

  hasActiveMix(): boolean {
    return Boolean(this.mixedTrack);
  }

  async restore(
    primaryTrack: MediaStreamTrack | undefined,
    connect: (track: MediaStreamTrack) => Promise<void>,
    includeApplication = true,
  ): Promise<void> {
    if (includeApplication && this.hasApplicationAudio() && primaryTrack) {
      await this.mix(primaryTrack, undefined, connect);
      return;
    }
    const revision = this.revision;
    if (primaryTrack?.readyState === "live" && this.hasActiveMix()) await connect(primaryTrack);
    if (revision === this.revision) this.dispose();
  }

  async mix(
    microphoneTrack: MediaStreamTrack,
    systemAudioTrack: MediaStreamTrack | undefined,
    connect?: (track: MediaStreamTrack) => Promise<void>,
    applicationAudioTrack = this.applicationTrack,
  ): Promise<MediaStreamTrack> {
    const revision = ++this.revision;
    let context: AudioContext;
    try {
      context = new AudioContext({
        latencyHint: "interactive",
        sampleRate: applicationAudioTrack ? 48_000 : 32_000,
      });
    } catch {
      context = new AudioContext({ latencyHint: "interactive" });
    }

    let preparedTrack: MediaStreamTrack | undefined;
    let unlinkGate: (() => void) | undefined;
    try {
      const destination = context.createMediaStreamDestination();
      const microphoneSource = context.createMediaStreamSource(new MediaStream([microphoneTrack]));
      const microphoneGain = context.createGain();
      const systemGain = context.createGain();
      microphoneGain.gain.value = 1;
      systemGain.gain.value = 0.72;
      microphoneSource.connect(microphoneGain).connect(destination);
      if (systemAudioTrack)
        context
          .createMediaStreamSource(new MediaStream([systemAudioTrack]))
          .connect(systemGain)
          .connect(destination);
      if (applicationAudioTrack)
        context
          .createMediaStreamSource(new MediaStream([applicationAudioTrack]))
          .connect(destination);

      const mixedTrack = destination.stream.getAudioTracks()[0];
      preparedTrack = mixedTrack;
      if (!mixedTrack) {
        await context.close();
        throw new Error("screen_audio_mix_track_missing");
      }

      mixedTrack.contentHint = "speech";
      unlinkGate = linkAudioSendGate(microphoneTrack, mixedTrack);
      // Keep the previous graph alive until every sender accepts the replacement.
      await connect?.(mixedTrack);
      if (revision !== this.revision) throw new Error("screen_audio_mix_superseded");
      this.disposeGraph();
      this.context = context;
      this.mixedTrack = mixedTrack;
      this.unlinkGate = unlinkGate;
      void writeRendererLog("audio", "info", "Screen system audio mixed with microphone", {
        contextSampleRate: context.sampleRate,
        hasScreenAudio: Boolean(systemAudioTrack),
        hasApplicationAudio: Boolean(applicationAudioTrack),
      });
      return mixedTrack;
    } catch (error) {
      unlinkGate?.();
      preparedTrack?.stop();
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  dispose(): void {
    this.applicationTrack = undefined;
    this.disposeGraph();
  }
  private disposeGraph(): void {
    this.revision++;
    this.unlinkGate?.();
    this.unlinkGate = undefined;
    this.mixedTrack?.stop();
    this.mixedTrack = undefined;
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = undefined;
    }
  }
}
