import {
  APP_NAME,
  RecordingState,
  type RecordingOptions,
  type RecordingResult,
  type RecordingStatusSnapshot,
} from "@private-voice/shared";

import { detectRecordingCapability } from "./mime-capability";
import { BrowserRecordingEncoder, type RecordingEncoder } from "./recording-encoder";
import {
  type RecordingExporter,
  type StreamingRecordingExporter,
  toRecordingResult,
} from "./recording-exporter";
import { RecordingStateMachine } from "./recording-state-machine";

export interface RecordingServiceOptions {
  exporter: RecordingExporter;
  streamingExporter?: StreamingRecordingExporter;
  logger?: (message: string, context?: Record<string, unknown>) => void;
  onStateChange?: (snapshot: RecordingStatusSnapshot) => void;
}

export class RecordingService {
  private readonly stateMachine = new RecordingStateMachine();
  private readonly capability = detectRecordingCapability();
  private readonly encoder = new BrowserRecordingEncoder(this.capability);
  private streamSession?: Promise<string>;
  private stopOperation?: Promise<RecordingResult>;

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

  hasRecording(): boolean {
    return this.encoder.hasRecording();
  }

  start(stream: MediaStream): RecordingStatusSnapshot {
    const current = this.getState();
    if (
      this.stopOperation ||
      this.encoder.hasRecording() ||
      current.state === RecordingState.Stopping ||
      current.state === RecordingState.Saving
    ) {
      return current;
    }
    this.emitState(
      this.stateMachine.transition(RecordingState.Preparing, {
        startedAt: Date.now(),
        durationMs: 0,
        result: undefined,
        message: "正在准备录音",
      }),
    );

    try {
      this.encoder.start(
        stream,
        this.options.streamingExporter ? (buffer) => this.appendStreamChunk(buffer) : undefined,
      );
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
          message: error instanceof Error ? error.message : "这台设备暂时无法开始录音。",
        }),
      );
    }
  }

  stop(options: RecordingOptions, actualSampleRate: number): Promise<RecordingResult> {
    if (this.stopOperation) return this.stopOperation;
    if (this.getState().state === RecordingState.Stopping) {
      return Promise.reject(new Error("recording_discard_in_progress"));
    }
    const operation = this.stopNow(options, actualSampleRate);
    this.stopOperation = operation;
    void operation.then(
      () => {
        if (this.stopOperation === operation) this.stopOperation = undefined;
      },
      () => {
        if (this.stopOperation === operation) this.stopOperation = undefined;
      },
    );
    return operation;
  }

  private async stopNow(
    options: RecordingOptions,
    actualSampleRate: number,
  ): Promise<RecordingResult> {
    if (!this.encoder.hasRecording()) {
      const message = "录音会话已经中断，没有找到可保存的音频。请重新开始录音。";
      this.emitState(
        this.stateMachine.transition(RecordingState.Failed, {
          startedAt: undefined,
          durationMs: 0,
          message,
        }),
      );
      throw new Error(message);
    }

    this.emitState(
      this.stateMachine.transition(RecordingState.Stopping, {
        message: "正在停止录音",
      }),
    );

    let encoded: Awaited<ReturnType<RecordingEncoder["stop"]>>;
    try {
      encoded = await this.encoder.stop();
    } catch (error) {
      await this.sealFailedSession();
      const message = error instanceof Error ? error.message : "录音编码器停止失败。";
      this.emitState(
        this.stateMachine.transition(RecordingState.Failed, {
          message,
        }),
      );
      throw error;
    }

    this.emitState(
      this.stateMachine.transition(RecordingState.Saving, {
        durationMs: encoded.durationMs,
        message: "正在保存 .m4a 录音",
      }),
    );

    const suggestedFileName = `${APP_NAME}-${new Date().toISOString().replaceAll(":", "-")}.m4a`;
    const session = this.streamSession;
    try {
      const response =
        session && this.options.streamingExporter
          ? await this.options.streamingExporter.finalizeSession({
              sessionId: await session,
              sourceMimeType: encoded.mimeType,
              sampleRate: actualSampleRate,
              channels: options.channels,
              suggestedFileName,
              targetFormat: options.targetFormat,
              durationMs: encoded.durationMs,
            })
          : encoded.blob
            ? await this.options.exporter.exportRecording({
                buffer: await encoded.blob.arrayBuffer(),
                sampleRate: actualSampleRate,
                sourceMimeType: encoded.mimeType,
                channels: options.channels,
                suggestedFileName,
                targetFormat: options.targetFormat,
              })
            : {
                ok: false,
                errorMessage: "录音没有产生可保存的音频数据。",
              };
      if (!response.ok) throw new Error(response.errorMessage ?? "录音导出失败。");
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
    } catch (error) {
      await this.sealFailedSession();
      const message = error instanceof Error ? error.message : "录音导出失败。";
      this.options.logger?.("recording export failed", { errorCode: "recording_export_failed" });
      this.emitState(
        this.stateMachine.transition(RecordingState.Failed, {
          durationMs: encoded.durationMs,
          message,
        }),
      );
      throw error;
    } finally {
      // The main process retains a failed session's temporary input for recovery.
      // Releasing this reference never asks it to delete that file.
      this.streamSession = undefined;
    }
  }

  async discard(): Promise<void> {
    if (this.stopOperation) return;
    const state = this.getState().state;
    if (state === RecordingState.Stopping || state === RecordingState.Saving) return;
    if (!this.encoder.hasRecording()) {
      this.emitState(
        this.stateMachine.transition(RecordingState.Idle, {
          startedAt: undefined,
          durationMs: 0,
          result: undefined,
          message: "录音会话已经结束",
        }),
      );
      return;
    }

    this.emitState(
      this.stateMachine.transition(RecordingState.Stopping, {
        message: "正在结束录音",
      }),
    );

    try {
      await this.encoder.stop();
      if (this.streamSession && this.options.streamingExporter) {
        const sessionId = await this.streamSession;
        await this.options.streamingExporter.abortSession(sessionId);
      }
    } catch (error) {
      await this.sealFailedSession();
      this.emitState(
        this.stateMachine.transition(RecordingState.Failed, {
          message: error instanceof Error ? error.message : "录音结束失败。",
        }),
      );
      throw error;
    } finally {
      // A failed stream may still have a recoverable input in the main process.
      this.streamSession = undefined;
    }
    this.emitState(
      this.stateMachine.transition(RecordingState.Idle, {
        startedAt: undefined,
        durationMs: 0,
        result: undefined,
        message: "录音未保存",
      }),
    );
    this.options.logger?.("recording discarded by user");
  }

  private appendStreamChunk(buffer: ArrayBuffer): Promise<void> {
    const streamingExporter = this.options.streamingExporter;
    if (!streamingExporter) return Promise.resolve();
    if (!this.streamSession) {
      this.streamSession = streamingExporter
        .startSession({ sourceMimeType: this.capability.mimeType ?? "application/octet-stream" })
        .then((response) => {
          if (!response.ok || !response.sessionId) {
            throw new Error(response.errorMessage ?? "录音流式会话创建失败。");
          }
          return response.sessionId;
        });
    }
    return this.streamSession.then((sessionId) => streamingExporter.appendChunk(sessionId, buffer));
  }

  private async sealFailedSession(): Promise<void> {
    const session = this.streamSession;
    this.streamSession = undefined;
    if (!session || !this.options.streamingExporter?.sealSession) return;
    try {
      await this.options.streamingExporter.sealSession(await session);
    } catch {
      this.options.logger?.("recording session seal failed", {
        errorCode: "recording_session_seal_failed",
      });
    }
  }
}
