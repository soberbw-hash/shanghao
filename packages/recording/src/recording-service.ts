import {
  APP_NAME,
  RecordingState,
  type RecordingOptions,
  type RecordingResult,
  type RecordingStatusSnapshot,
} from "@private-voice/shared";

import { detectRecordingCapability } from "./mime-capability";
import { BrowserRecordingEncoder } from "./recording-encoder";
import { type RecordingExporter, toRecordingResult } from "./recording-exporter";
import { RecordingStateMachine } from "./recording-state-machine";

export interface RecordingServiceOptions {
  exporter: RecordingExporter;
  logger?: (message: string, context?: Record<string, unknown>) => void;
  onStateChange?: (snapshot: RecordingStatusSnapshot) => void;
}

export class RecordingService {
  private readonly stateMachine = new RecordingStateMachine();
  private readonly capability = detectRecordingCapability();
  private readonly encoder = new BrowserRecordingEncoder(this.capability);

  constructor(private readonly options: RecordingServiceOptions) {}

  private emitState(snapshot: RecordingStatusSnapshot): RecordingStatusSnapshot {
    this.options.onStateChange?.(snapshot);
    return snapshot;
  }

  getCapability() {
    return this.capability;
  }

  getState(): RecordingStatusSnapshot {
    return this.stateMachine.getState();
  }

  start(stream: MediaStream): RecordingStatusSnapshot {
    this.emitState(
      this.stateMachine.transition(RecordingState.Preparing, {
        startedAt: Date.now(),
        durationMs: 0,
        message: "正在准备录音",
      }),
    );

    try {
      this.encoder.start(stream);
      return this.emitState(
        this.stateMachine.transition(RecordingState.Recording, {
          startedAt: Date.now(),
          message: "录音进行中",
        }),
      );
    } catch (error) {
      return this.emitState(
        this.stateMachine.transition(RecordingState.Failed, {
          startedAt: undefined,
          durationMs: 0,
          message:
            error instanceof Error
              ? error.message
              : "这台设备暂时无法开始录音。",
        }),
      );
    }
  }

  async stop(options: RecordingOptions, actualSampleRate: number): Promise<RecordingResult> {
    this.emitState(
      this.stateMachine.transition(RecordingState.Stopping, {
        message: "正在停止录音",
      }),
    );

    const encoded = await this.encoder.stop();

    this.emitState(
      this.stateMachine.transition(RecordingState.Saving, {
        durationMs: encoded.durationMs,
        message: "正在保存 .m4a 录音",
      }),
    );

    const buffer = await encoded.blob.arrayBuffer();
    const response = await this.options.exporter.exportRecording({
      buffer,
      sampleRate: actualSampleRate,
      sourceMimeType: encoded.mimeType,
      channels: options.channels,
      suggestedFileName: `${APP_NAME}-${new Date().toISOString().replaceAll(":", "-")}.m4a`,
      targetFormat: options.targetFormat,
    });

    if (!response.ok) {
      this.options.logger?.("recording export failed", { ...response });
      this.emitState(
        this.stateMachine.transition(RecordingState.Failed, {
          durationMs: encoded.durationMs,
          message: response.errorMessage,
        }),
      );
      throw new Error(response.errorMessage ?? "录音导出失败。");
    }

    const result = toRecordingResult(
      response,
      encoded.mimeType,
      encoded.durationMs,
      actualSampleRate,
    );

    this.options.logger?.("recording export complete", { ...result });

    this.emitState(
      this.stateMachine.transition(RecordingState.Saved, {
        durationMs: result.durationMs,
        result,
        message: "录音已保存为 .m4a",
      }),
    );

    return result;
  }
}
