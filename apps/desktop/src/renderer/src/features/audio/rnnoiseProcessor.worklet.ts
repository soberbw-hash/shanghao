import { Rnnoise, type DenoiseState } from "@shiguredo/rnnoise-wasm";

declare const sampleRate: number;

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

declare const registerProcessor: (
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
) => void;

type ProcessorMode = "loading" | "active" | "failed";

const RNNOISE_SAMPLE_RATE = 48_000;
const PCM_SCALE = 32_768;
const OVERLOAD_WARMUP_FRAMES = 300;
const OVERLOAD_WINDOW_FRAMES = 300;
const OVERLOAD_FRAME_LIMIT = 90;
const OVERLOAD_STRIKE_LIMIT = 2;
const FRAME_BUDGET_MS = 10;
const VOICE_HOLD_FRAMES = 18;
const RESIDUAL_GATE_FLOOR = 0.08;

class ShangHaoRnnoiseProcessor extends AudioWorkletProcessor {
  private mode: ProcessorMode = "loading";
  private denoiseState?: DenoiseState;
  private frameSize = 480;
  private inputAt48k: number[] = [];
  private inputReadOffset = 0;
  private outputAtNativeRate: number[] = [];
  private outputReadOffset = 0;
  private inputResamplePosition = 1;
  private outputResamplePosition = 1;
  private previousNativeSample = 0;
  private previous48kSample = 0;
  private hasNativeHistory = false;
  private has48kHistory = false;
  private noiseGateGain = 1;
  private noiseGateHoldFrames = 0;
  private smoothedVadProbability = 0;
  private noiseFloorRms = 0.0025;
  private previousFramePeak = 0;
  private transientHoldFrames = 0;
  private processedFrames = 0;
  private processorOverruns = 0;
  private totalProcessingMs = 0;
  private maxProcessingMs = 0;
  private overloadWindowFrames = 0;
  private overloadWindowCount = 0;
  private overloadStrikeCount = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "dispose") {
        this.denoiseState?.destroy();
        this.denoiseState = undefined;
        this.mode = "failed";
      }
    };

    void Rnnoise.load()
      .then((rnnoise) => {
        this.frameSize = rnnoise.frameSize;
        this.denoiseState = rnnoise.createDenoiseState();
        this.mode = "active";
        this.port.postMessage({ type: "ready", frameSize: this.frameSize });
      })
      .catch((error: unknown) => {
        this.mode = "failed";
        this.port.postMessage({
          type: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private resampleTo48k(input: Float32Array): void {
    if (sampleRate === RNNOISE_SAMPLE_RATE) {
      for (let index = 0; index < input.length; index += 1) {
        this.inputAt48k.push(input[index] ?? 0);
      }
      return;
    }

    if (!input.length) return;
    if (!this.hasNativeHistory) {
      this.previousNativeSample = input[0] ?? 0;
      this.hasNativeHistory = true;
    }
    const sourceStep = sampleRate / RNNOISE_SAMPLE_RATE;
    while (this.inputResamplePosition < input.length) {
      const leftIndex = Math.floor(this.inputResamplePosition);
      const rightIndex = Math.min(input.length, leftIndex + 1);
      const fraction = this.inputResamplePosition - leftIndex;
      const left = leftIndex <= 0 ? this.previousNativeSample : (input[leftIndex - 1] ?? 0);
      const right = input[rightIndex - 1] ?? left;
      this.inputAt48k.push(left + (right - left) * fraction);
      this.inputResamplePosition += sourceStep;
    }
    this.inputResamplePosition -= input.length;
    this.previousNativeSample = input[input.length - 1] ?? this.previousNativeSample;
  }

  private resampleFrom48k(frame: Float32Array): void {
    if (sampleRate === RNNOISE_SAMPLE_RATE) {
      for (let index = 0; index < frame.length; index += 1) {
        this.outputAtNativeRate.push(frame[index] ?? 0);
      }
      return;
    }

    if (!frame.length) return;
    if (!this.has48kHistory) {
      this.previous48kSample = frame[0] ?? 0;
      this.has48kHistory = true;
    }
    const sourceStep = RNNOISE_SAMPLE_RATE / sampleRate;
    while (this.outputResamplePosition < frame.length) {
      const leftIndex = Math.floor(this.outputResamplePosition);
      const rightIndex = Math.min(frame.length, leftIndex + 1);
      const fraction = this.outputResamplePosition - leftIndex;
      const left = leftIndex <= 0 ? this.previous48kSample : (frame[leftIndex - 1] ?? 0);
      const right = frame[rightIndex - 1] ?? left;
      this.outputAtNativeRate.push(left + (right - left) * fraction);
      this.outputResamplePosition += sourceStep;
    }
    this.outputResamplePosition -= frame.length;
    this.previous48kSample = frame[frame.length - 1] ?? this.previous48kSample;
  }

  private applyResidualNoiseGateAndLimiter(frame: Float32Array, vadProbability: number): void {
    let energy = 0;
    let peak = 0;
    for (const sample of frame) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(energy / Math.max(1, frame.length));
    const normalizedVad = Math.max(0, Math.min(1, vadProbability));
    const vadSmoothing = normalizedVad > this.smoothedVadProbability ? 0.45 : 0.08;
    this.smoothedVadProbability += (normalizedVad - this.smoothedVadProbability) * vadSmoothing;

    const crestFactor = peak / Math.max(0.000_01, rms);
    const isKeyboardLikeTransient =
      normalizedVad < 0.18 &&
      this.smoothedVadProbability < 0.24 &&
      peak > 0.075 &&
      crestFactor > 6.5 &&
      peak > Math.max(0.02, this.previousFramePeak * 1.7);
    this.previousFramePeak = peak;
    if (isKeyboardLikeTransient) this.transientHoldFrames = 2;
    else if (this.transientHoldFrames > 0) this.transientHoldFrames -= 1;

    // Learn the remaining room-noise floor only while RNNoise is confident that
    // there is no speech. This keeps the gate useful for fans and keyboards
    // without cutting quiet syllables after the user starts talking.
    if (this.smoothedVadProbability < 0.18 && !isKeyboardLikeTransient && rms < 0.04) {
      const noiseLearningRate = rms > this.noiseFloorRms ? 0.012 : 0.035;
      this.noiseFloorRms += (rms - this.noiseFloorRms) * noiseLearningRate;
      this.noiseFloorRms = Math.max(0.000_8, Math.min(0.018, this.noiseFloorRms));
    }

    const voiceDetected =
      normalizedVad >= 0.52 ||
      this.smoothedVadProbability >= 0.38 ||
      rms >= Math.max(0.012, this.noiseFloorRms * 4.2);
    if (voiceDetected) this.noiseGateHoldFrames = VOICE_HOLD_FRAMES;
    else if (this.noiseGateHoldFrames > 0) this.noiseGateHoldFrames -= 1;

    const closeThreshold = Math.max(0.0022, this.noiseFloorRms * 1.28);
    const openThreshold = Math.max(0.0065, this.noiseFloorRms * 2.6);
    let targetGain: number;
    if (this.noiseGateHoldFrames > 0) {
      targetGain = 1;
    } else if (this.smoothedVadProbability >= 0.24) {
      targetGain = 0.66 + this.smoothedVadProbability * 0.34;
    } else if (rms <= closeThreshold) {
      targetGain = RESIDUAL_GATE_FLOOR;
    } else if (rms < openThreshold) {
      const progress = (rms - closeThreshold) / Math.max(0.000_1, openThreshold - closeThreshold);
      targetGain = RESIDUAL_GATE_FLOOR + progress * 0.58;
    } else {
      targetGain = 0.72;
    }
    if (this.transientHoldFrames > 0 && this.noiseGateHoldFrames === 0) {
      targetGain = Math.min(targetGain, 0.3);
    }

    const limiterGain = peak > 0.96 ? 0.96 / peak : 1;
    const smoothing = targetGain > this.noiseGateGain ? 0.022 : 0.0028;
    for (let index = 0; index < frame.length; index += 1) {
      this.noiseGateGain += (targetGain - this.noiseGateGain) * smoothing;
      frame[index] = (frame[index] ?? 0) * this.noiseGateGain * limiterGain;
    }
  }

  private processAvailableFrames(): void {
    const denoiseState = this.denoiseState;
    if (!denoiseState) {
      return;
    }

    while (this.inputAt48k.length - this.inputReadOffset >= this.frameSize) {
      const startedAt = performance.now();
      const frame = new Float32Array(this.frameSize);
      for (let index = 0; index < this.frameSize; index += 1) {
        frame[index] = (this.inputAt48k[this.inputReadOffset + index] ?? 0) * PCM_SCALE;
      }
      this.inputReadOffset += this.frameSize;

      const vadProbability = denoiseState.processFrame(frame);
      for (let index = 0; index < frame.length; index += 1) {
        frame[index] = Math.max(-1, Math.min(1, (frame[index] ?? 0) / PCM_SCALE));
      }
      this.applyResidualNoiseGateAndLimiter(frame, vadProbability);
      this.resampleFrom48k(frame);

      const processingMs = performance.now() - startedAt;
      this.processedFrames += 1;
      this.totalProcessingMs += processingMs;
      this.maxProcessingMs = Math.max(this.maxProcessingMs, processingMs);
      if (processingMs > FRAME_BUDGET_MS) {
        this.processorOverruns += 1;
      }

      if (this.processedFrames % 100 === 0) {
        this.port.postMessage({
          type: "diagnostics",
          processorOverruns: this.processorOverruns,
          averageProcessingMs: this.totalProcessingMs / this.processedFrames,
          maxProcessingMs: this.maxProcessingMs,
          vadProbability: this.smoothedVadProbability,
          noiseFloorRms: this.noiseFloorRms,
        });
      }

      // Ignore startup/JIT spikes, then require two sustained overloaded windows
      // before falling back. A single slow frame should never alarm the user.
      if (this.processedFrames > OVERLOAD_WARMUP_FRAMES) {
        this.overloadWindowFrames += 1;
        if (processingMs > FRAME_BUDGET_MS) {
          this.overloadWindowCount += 1;
        }
      }

      if (this.overloadWindowFrames >= OVERLOAD_WINDOW_FRAMES) {
        this.overloadStrikeCount =
          this.overloadWindowCount >= OVERLOAD_FRAME_LIMIT ? this.overloadStrikeCount + 1 : 0;
        this.overloadWindowFrames = 0;
        this.overloadWindowCount = 0;

        if (this.overloadStrikeCount >= OVERLOAD_STRIKE_LIMIT) {
          this.mode = "failed";
          this.denoiseState?.destroy();
          this.denoiseState = undefined;
          this.port.postMessage({
            type: "overloaded",
            processorOverruns: this.processorOverruns,
            averageProcessingMs: this.totalProcessingMs / this.processedFrames,
            maxProcessingMs: this.maxProcessingMs,
          });
          return;
        }
      }
    }

    if (this.inputReadOffset >= this.frameSize * 4) {
      this.inputAt48k.splice(0, this.inputReadOffset);
      this.inputReadOffset = 0;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) {
      return true;
    }

    if (!input || this.mode !== "active") {
      output.set(input ?? new Float32Array(output.length));
      return true;
    }

    this.resampleTo48k(input);
    try {
      this.processAvailableFrames();
    } catch (error) {
      this.mode = "failed";
      this.denoiseState?.destroy();
      this.denoiseState = undefined;
      this.port.postMessage({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      output.set(input);
      return true;
    }

    if (this.outputAtNativeRate.length - this.outputReadOffset < output.length) {
      output.fill(0);
      return true;
    }

    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.outputAtNativeRate[this.outputReadOffset + index] ?? 0;
    }
    this.outputReadOffset += output.length;
    if (this.outputReadOffset >= this.frameSize * 4) {
      this.outputAtNativeRate.splice(0, this.outputReadOffset);
      this.outputReadOffset = 0;
    }
    return true;
  }
}

registerProcessor("shanghao-rnnoise", ShangHaoRnnoiseProcessor);
