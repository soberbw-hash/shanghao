/* global AudioWorkletProcessor, registerProcessor */
class ApplicationPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (
        !data ||
        !(data.bytes instanceof ArrayBuffer) ||
        ![1, 2].includes(data.channels) ||
        data.bytes.byteLength > 3840 ||
        data.bytes.byteLength % (data.channels * 2)
      )
        return;
      const packet = {
        data: new DataView(data.bytes),
        channels: data.channels,
        frames: data.bytes.byteLength / (data.channels * 2),
      };
      // Drop stale samples rather than stretching queued sound after a busy frame.
      if (this.queue.length >= 6) {
        this.queue = this.queue.slice(-2);
        this.offset = 0;
      }
      this.queue.push(packet);
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out?.length) return true;
    for (let i = 0; i < out[0].length; i++) {
      const packet = this.queue[0];
      if (!packet) break;
      for (let channel = 0; channel < out.length; channel++)
        out[channel][i] =
          packet.data.getInt16(
            (this.offset * packet.channels + Math.min(channel, packet.channels - 1)) * 2,
            true,
          ) / 32768;
      if (++this.offset >= packet.frames) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("shanghao-application-pcm", ApplicationPcmProcessor);
