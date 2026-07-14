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

class ShangHaoRnnoiseProcessor extends AudioWorkletProcessor {
  private mode: ProcessorMode = "loading";
  private denoiseState?: DenoiseState;
  private frameSize = 480;
  private inputAt48k: number[] = [];
  private inputReadOffset = 0;
  private outputAtNativeRate: number[] = [];
  private outputReadOffset = 0;
  private inputResampleCarry = 0;
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

    const exactLength = this.inputResampleCarry + (input.length * RNNOISE_SAMPLE_RATE) / sampleRate;
    const outputLength = Math.floor(exactLength);
    this.inputResampleCarry = exactLength - outputLength;

    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = (index * (input.length - 1)) / Math.max(1, outputLength - 1);
      const leftIndex = Math.floor(sourcePosition);
      const rightIndex = Math.min(input.length - 1, leftIndex + 1);
      const fraction = sourcePosition - leftIndex;
      const left = input[leftIndex] ?? 0;
      const right = input[rightIndex] ?? left;
      this.inputAt48k.push(left + (right - left) * fraction);
    }
  }

  private resampleFrom48k(frame: Float32Array): void {
    if (sampleRate === RNNOISE_SAMPLE_RATE) {
      for (let index = 0; index < frame.length; index += 1) {
        this.outputAtNativeRate.push(frame[index] ?? 0);
      }
      return;
    }

    const outputLength = Math.max(1, Math.round((frame.length * sampleRate) / RNNOISE_SAMPLE_RATE));
    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = (index * (frame.length - 1)) / Math.max(1, outputLength - 1);
      const leftIndex = Math.floor(sourcePosition);
      const rightIndex = Math.min(frame.length - 1, leftIndex + 1);
      const fraction = sourcePosition - leftIndex;
      const left = frame[leftIndex] ?? 0;
      const right = frame[rightIndex] ?? left;
      this.outputAtNativeRate.push(left + (right - left) * fraction);
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

      denoiseState.processFrame(frame);
      for (let index = 0; index < frame.length; index += 1) {
        frame[index] = Math.max(-1, Math.min(1, (frame[index] ?? 0) / PCM_SCALE));
      }
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
      output.set(input);
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
