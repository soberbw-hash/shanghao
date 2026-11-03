/* global AudioWorkletProcessor, registerProcessor */
class VoiceReplayProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(4096);
    this.offset = 0;
    this.pending = 0;
    this.active = true;
    this.gapSent = false;
    this.port.onmessage = ({ data }) => {
      if (data === "ack") this.pending = Math.max(0, this.pending - 1);
      if (data === "stop") { this.active = false; this.block.fill(0); this.offset = 0; }
    };
  }
  process(inputs) {
    if (!this.active) return false;
    // Output stays silent: this graph observes the call and never feeds it back.
    const length = inputs[0]?.[0]?.length ?? inputs[1]?.[0]?.length ?? 128;
    for (let i = 0; i < length; i++) {
      let mixed = 0;
      for (const channels of inputs) {
        if (!channels.length) continue;
        let value = 0;
        for (const channel of channels) value += channel[i] || 0;
        mixed += value / channels.length;
      }
      this.block[this.offset++] = Math.max(-1, Math.min(1, mixed));
      if (this.offset === this.block.length) {
        // A stalled renderer must not accumulate unbounded PCM or block the audio thread.
        if (this.pending < 2) {
          const samples = this.block;
          this.port.postMessage(samples, [samples.buffer]);
          this.pending++;
          this.gapSent = false;
          this.block = new Float32Array(4096);
        } else {
          this.block.fill(0);
          if (!this.gapSent) { this.port.postMessage("gap"); this.gapSent = true; }
        }
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("shanghao-voice-replay", VoiceReplayProcessor);
