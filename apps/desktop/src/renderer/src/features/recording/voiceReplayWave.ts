/** Encode an already-consented replay snapshot as mono 16-bit PCM WAV. */
export function encodeVoiceReplayWave(samples: Float32Array, sampleRate: number): Uint8Array {
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 1 ||
    sampleRate > 192_000 ||
    samples.length > sampleRate * 60
  ) {
    throw new RangeError("invalid_voice_replay_audio");
  }
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i] ?? 0;
    const sample = Number.isFinite(input) ? Math.max(-1, Math.min(1, input)) : 0;
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
