import type { ApplicationAudioFrame } from "@private-voice/shared";
import workletUrl from "./applicationAudio.worklet.js?url";

/** This graph has no local speaker connection; its track is sent to the room. */
export class ApplicationAudioPlayer {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private gain?: GainNode;
  private track?: MediaStreamTrack;
  private disposed = false;
  async prepare(): Promise<MediaStreamTrack> {
    const context = (this.context = new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    }));
    try {
      await context.audioWorklet.addModule(workletUrl);
      if (this.disposed) throw Error("application_audio_aborted");
      const node = (this.node = new AudioWorkletNode(context, "shanghao-application-pcm", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      }));
      const destination = context.createMediaStreamDestination();
      const gain = (this.gain = context.createGain());
      gain.gain.value = 0.72;
      node.connect(gain).connect(destination);
      await context.resume();
      if (this.disposed) throw Error("application_audio_aborted");
      this.track = destination.stream.getAudioTracks()[0];
      if (!this.track) throw Error("application_audio_track_missing");
      return this.track;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  push(frame: ApplicationAudioFrame): void {
    if (
      !this.node ||
      this.disposed ||
      Date.now() - frame.capturedAt > 200 ||
      frame.sampleRate !== 48000 ||
      frame.frames > 960
    )
      return;
    const bytes = new Uint8Array(frame.data);
    if (bytes.length !== frame.frames * frame.channels * 2) return;
    this.node.port.postMessage({ bytes: bytes.buffer, channels: frame.channels }, [bytes.buffer]);
  }
  setGain(value: number): void {
    if (this.gain && Number.isFinite(value))
      this.gain.gain.setTargetAtTime(
        Math.max(0, Math.min(2, value)),
        this.context!.currentTime,
        0.02,
      );
  }
  dispose(): void {
    this.disposed = true;
    this.node?.disconnect();
    this.node?.port.close();
    this.track?.stop();
    void this.context?.close().catch(() => undefined);
    this.node = undefined;
    this.track = undefined;
    this.context = undefined;
  }
}
