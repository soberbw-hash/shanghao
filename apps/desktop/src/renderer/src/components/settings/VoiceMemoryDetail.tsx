import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  ChevronDown,
  Eye,
  FileText,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import {
  AI_ASR_MODEL_NAMES,
  hasInvalidVoiceMemoryResult,
  mergeTranscriptIntoSentences,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import {
  shouldActivateVoiceMemoryVariant,
  voiceMemoryTranscriptionPercent,
} from "../../features/ai/voiceMemoryPresentation";
import { playUiSound } from "../../features/audio/uiSound";

interface VoiceMemoryDetailProps {
  recording: RecordingLibraryItem;
  roomName: string;
  selectedAsrModel: AiAsrModelId;
  onSelectAsrModel: (modelId: AiAsrModelId) => Promise<void> | void;
  onSeek: (offsetMs: number) => void;
}

const clock = (offsetMs: number): string => {
  const seconds = Math.max(0, Math.floor(offsetMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
};

const formatTranscriptionElapsed = (milliseconds?: number): string | undefined =>
  milliseconds === undefined ? undefined : `${(Math.max(0, milliseconds) / 1_000).toFixed(1)} 秒`;

const DEFAULT_ASR_MODEL_ID: AiAsrModelId = "qwen3-asr-0.6b-force";

const isKnownAsrModelId = (value: string): value is AiAsrModelId =>
  Object.prototype.hasOwnProperty.call(AI_ASR_MODEL_NAMES, value);

const describeError = (message: string, transcriptionFinished: boolean): string => {
  if (message.includes("no_reliable_speech")) {
    return "没有检测到可靠的中文语音；模型返回的其他语言结果已被拦截，请重新转录。";
  }
  if (message.includes("_not_installed")) return "当前选择的转录模型还没有下载。";
  if (
    message.includes("qwen3_asr_cuda_required") ||
    message.includes("qwen3_asr_cuda_bf16_required")
  )
    return "Qwen GPU运行环境异常，请检查AI Runtime。";
  if (
    message.includes("fun_asr_cuda_required") ||
    message.includes("fun_asr_nano_2512_cuda_required") ||
    message.includes("fun_asr_nano_2512_cuda_bf16_required")
  )
    return "Fun-ASR GPU运行环境异常，请检查AI Runtime。";
  if (
    message.includes("glm_asr_cuda_required") ||
    message.includes("glm_asr_nano_2512_cuda_required") ||
    message.includes("glm_asr_nano_2512_cuda_bf16_required")
  )
    return "GLM-ASR GPU运行环境异常，请检查AI Runtime。";
  if (
    message.includes("firered_asr_cuda_required") ||
    message.includes("fireredasr2_aed_cuda_required")
  )
    return "FireRedASR GPU运行环境异常，请检查AI Runtime。";
  if (message.includes("cuda_runtime_unavailable") || message.includes("bf16_runtime_unavailable"))
    return "GPU运行环境异常，请检查AI Runtime。";
  if (message.includes("_runtime_not_ready") || message.includes("_runtime_unavailable"))
    return "当前转录模型的运行组件还没有准备好，请到“AI 功能”中修复组件。";
  if (message.includes("No module named 'torchaudio'") || message.includes("torchaudio"))
    return "Paraformer 的语音运行组件不完整，请到“AI 功能”中点击“修复组件”后再继续转录。";
  if (message.includes("ffmpeg_missing"))
    return "录音格式转换组件尚未载入。请完全退出上号（包括托盘）后重新打开；若仍出现，再重新安装当前版本。";
  if (message.includes("ffmpeg_failed"))
    return "录音格式转换没有完成，请确认录音文件仍可播放后重新转录。";
  if (message.includes("wav_invalid") || message.includes("unsupported_transcription_wav")) {
    return "这条录音暂时无法转换为转录格式，请重新录制或更换可播放的音频文件。";
  }
  if (message.includes("dll_missing") || message.includes("0xc0000135")) {
    return "语音运行组件不完整，请到“AI 功能”中点击“修复组件”。";
  }
  if (message.includes("ai_runtime_spawn_failed"))
    return "语音运行组件没有启动，请到“AI 功能”中点击“修复组件”。";
  if (message.includes("vibevoice_runtime_unavailable")) return "转录运行环境还没有准备好。";
  if (message.includes("ai_runtime_exit")) {
    return transcriptionFinished
      ? "文字已经转好，自动整理没有完成，可以重新整理。"
      : "上次转录没有完成，可以直接重试。";
  }
  if (message.includes("qwen_worker_timeout")) {
    return "本地千问整理耗时较长，已超过本次等待时间；转录文字已经保留，请稍后重新整理。";
  }
  if (message.includes("cloud_ai_join_required")) {
    return "转录文字已经保留。请先进入一号房或二号房，再使用云端模型整理。";
  }
  if (message.includes("cloud_ai_not_configured")) {
    return "转录文字已经保留，但房间服务器还没有配置好云端 AI。";
  }
  if (message.includes("cloud_ai_unsupported")) {
    return "转录文字已经保留，但当前房间服务器版本较旧，暂不支持云端整理。";
  }
  if (message.includes("cloud_ai_busy") || message.includes("cloud_ai_request_in_progress")) {
    return "转录文字已经保留。云端 AI 正在处理另一项任务，请稍后重新整理。";
  }
  if (message.includes("custom_ai_not_configured")) {
    return "转录文字已经保留。请先到“AI 功能”中保存自定义 API。";
  }
  if (message.includes("custom_ai_request_failed")) {
    return "转录文字已经保留。自定义 API 暂时无法连接，请检查地址、模型和密钥。";
  }
  if (message.includes("manual_required:long_recording")) {
    return "这条录音超过 30 分钟，为避免无人操作时长期占用电脑，已停止自动转录。需要时请点“继续”。";
  }
  if (message.includes("transcription_checkpoint_incompatible")) {
    return "上次转录使用的模型或处理版本已变化，现有文字已保留。可以切回原模型继续，或点“重新转录”从头识别。";
  }
  if (message.includes("transcription_checkpoint_missing")) {
    return "上次转录的续传断点已丢失，现有文字已保留。如需继续，请点“重新转录”从头识别。";
  }
  if (message.includes("ai_task_paused")) return "任务已暂停，需要时可以继续处理。";
  if (message.includes("voice_memory_transcript_required")) return "请先完成转录，再整理内容。";
  if (message.includes("organize_failed") || message.includes("ai_runtime_timeout")) {
    return "转录文字已经保留，内容整理没有完成；你仍然可以直接查看文字，稍后再点重新整理。";
  }
  if (message.includes("recording_file_unavailable")) return "录音文件已被移动或无法读取。";
  return message
    ? "转录没有完成，可以直接重试；详细原因已写入诊断日志。"
    : "转录没有完成，可以直接重试。";
};

/** Presents one recording as a linked transcript, timeline and summary. */
export const VoiceMemoryDetail = ({
  recording,
  roomName,
  selectedAsrModel,
  onSelectAsrModel,
  onSeek,
}: VoiceMemoryDetailProps) => {
  const [record, setRecord] = useState<VoiceMemoryRecord>();
  const [asrModels, setAsrModels] = useState<AiModelStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [queuedAction, setQueuedAction] = useState<"transcribe" | "organize">();
  const [error, setError] = useState<string>();
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const variantSelectionRef = useRef<string | undefined>(undefined);
  const previousPhaseRef = useRef<VoiceMemoryRecord["phase"] | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setQueuedAction(undefined);
    setDetailsOpen(false);
    previousPhaseRef.current = undefined;
    void window.desktopApi.ai.getVoiceMemory(recording.recordingId).then((value) => {
      if (!active) return;
      previousPhaseRef.current = value?.phase;
      setRecord(value);
      setDetailsOpen(
        (value?.phase === "transcribing" ||
          value?.phase === "organizing" ||
          value?.phase === "ready" ||
          Boolean(value?.transcript.length)) &&
          !(value && hasInvalidVoiceMemoryResult(value)),
      );
    });
    const unsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((value) => {
      if (active && value.recordingId === recording.recordingId) {
        const previousPhase = previousPhaseRef.current;
        if (previousPhase !== value.phase) {
          if (value.phase === "transcribing") playUiSound("transcription-start");
          else if (value.phase === "ready") playUiSound("transcription-complete");
          else if (value.phase === "error") playUiSound("process-error");
        }
        previousPhaseRef.current = value.phase;
        setRecord(value);
        if (value.phase === "transcribing" || value.phase === "organizing") setDetailsOpen(true);
        if (
          value.phase === "transcribing" ||
          value.phase === "organizing" ||
          value.phase === "ready" ||
          value.phase === "error" ||
          value.phase === "paused"
        ) {
          setQueuedAction(undefined);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [recording.filePath, recording.recordingId]);

  useEffect(() => {
    let active = true;
    void window.desktopApi.ai
      .getSnapshot()
      .then((snapshot) => {
        if (!active) return;
        setAsrModels(snapshot.models.filter((model) => model.category === "asr"));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const fallbackAsrModel = asrModels.find((model) => isKnownAsrModelId(model.id))?.id as
    AiAsrModelId | undefined;
  const effectiveSelectedAsrModel = isKnownAsrModelId(selectedAsrModel)
    ? selectedAsrModel
    : (fallbackAsrModel ?? DEFAULT_ASR_MODEL_ID);

  useEffect(() => {
    if (isKnownAsrModelId(selectedAsrModel) || !fallbackAsrModel) return;
    void onSelectAsrModel(fallbackAsrModel);
  }, [fallbackAsrModel, onSelectAsrModel, selectedAsrModel]);

  const selectedVariantUpdatedAt =
    record?.transcriptionVariants?.[effectiveSelectedAsrModel]?.updatedAt;

  useEffect(() => {
    if (!shouldActivateVoiceMemoryVariant(record, effectiveSelectedAsrModel)) return;
    const selectionKey = `${recording.recordingId}:${effectiveSelectedAsrModel}:${selectedVariantUpdatedAt ?? "saved"}`;
    if (variantSelectionRef.current === selectionKey) return;
    variantSelectionRef.current = selectionKey;
    let active = true;
    setBusy(true);
    setError(undefined);
    void window.desktopApi.ai
      .selectTranscription(recording.recordingId, effectiveSelectedAsrModel)
      .then((next) => {
        if (!active) return;
        setRecord(next);
        setDetailsOpen(true);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "切换转录结果失败");
      })
      .finally(() => {
        if (variantSelectionRef.current === selectionKey) {
          variantSelectionRef.current = undefined;
        }
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [
    record,
    record?.phase,
    record?.transcriptionModel?.id,
    recording.recordingId,
    effectiveSelectedAsrModel,
    selectedVariantUpdatedAt,
  ]);

  const process = async (action: "transcribe" | "organize") => {
    setBusy(true);
    setQueuedAction(action);
    setError(undefined);
    setDetailsOpen(true);
    try {
      const accepted = await window.desktopApi.ai.processRecording({
        recordingId: recording.recordingId,
        filePath: recording.filePath,
        roomId: recording.roomId,
        roomName,
        manual: true,
        transcribe: action === "transcribe",
        organize: action === "organize",
        restartTranscription: action === "transcribe",
        asrModelId: action === "transcribe" ? effectiveSelectedAsrModel : undefined,
        markers: recording.markers.map((marker) => ({
          id: marker.id,
          offsetMs: marker.offsetMs,
        })),
      });
      setRecord(accepted);
      if (accepted.phase !== "idle" || accepted.taskStatus !== "pending")
        setQueuedAction(undefined);
    } catch (cause) {
      setQueuedAction(undefined);
      setError(cause instanceof Error ? cause.message : "AI 处理失败");
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    setQueuedAction(record?.processingStage === "organize" ? "organize" : "transcribe");
    setError(undefined);
    setDetailsOpen(true);
    try {
      setRecord(await window.desktopApi.ai.resumeTask(recording.recordingId));
    } catch (cause) {
      setQueuedAction(undefined);
      setError(cause instanceof Error ? cause.message : "AI 处理失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmSpeaker = async (speakerId: string) => {
    const nickname = speakerNames[speakerId]?.trim();
    if (!nickname) return;
    setBusy(true);
    setError(undefined);
    try {
      setRecord(
        await window.desktopApi.ai.assignSpeaker(recording.filePath, speakerId, nickname, nickname),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "说话人确认失败");
    } finally {
      setBusy(false);
    }
  };

  const selectModel = async (modelId: AiAsrModelId) => {
    if (modelId === effectiveSelectedAsrModel) return;
    setBusy(true);
    setError(undefined);
    try {
      await onSelectAsrModel(modelId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "切换转录模型失败");
    } finally {
      setBusy(false);
    }
  };

  const invalidTranscript = useMemo(
    () => Boolean(record && hasInvalidVoiceMemoryResult(record)),
    [record],
  );
  const readableTranscript = useMemo(
    () => mergeTranscriptIntoSentences(record?.transcript ?? []),
    [record?.transcript],
  );

  if (!record) {
    return (
      <section className="voice-memory-empty">
        <BrainCircuit aria-hidden="true" />
        <div>
          <strong>这条录音还没有整理</strong>
          <span>转录、章节、精彩片段和问答都只在本机运行。</span>
        </div>
        <div className="voice-memory-header-actions">
          <button type="button" disabled={busy} onClick={() => void process("transcribe")}>
            <FileText aria-hidden="true" />
            {queuedAction === "transcribe" ? "排队中" : "开始转录"}
          </button>
          <button type="button" disabled aria-label="需要先转录才能整理">
            <Sparkles aria-hidden="true" />
            整理内容
          </button>
        </div>
        {error ? <p role="alert">{describeError(error, false)}</p> : null}
      </section>
    );
  }

  const working = record.phase === "transcribing" || record.phase === "organizing";
  const transcriptionFinished = record.transcript.length > 0 && !invalidTranscript;
  const organizationFailed = record.errorMessage?.startsWith("organize_failed:") === true;
  const pausedOrganization = record.phase === "paused" && record.processingStage === "organize";
  const resumableTranscription =
    record.processingStage !== "organize" &&
    (record.phase === "paused" || (record.phase === "error" && transcriptionFinished));
  const hasMultipleSpeakers = record.speakers.length > 1;
  const pendingSpeakers = hasMultipleSpeakers
    ? record.speakers.filter((speaker) => speaker.confidence === "pending")
    : [];
  const displayProgress =
    record.phase === "transcribing" ||
    (record.phase === "paused" && record.processingStage !== "organize")
      ? voiceMemoryTranscriptionPercent(record)
      : record.progress;
  const transcriptionModelLabel =
    record.transcriptionModel?.name ??
    (record.transcript.length > 0 ? "历史记录 · 模型未知" : undefined);
  const transcriptionModelTitle = record.transcriptionModel
    ? `转录模型：${record.transcriptionModel.name}${record.transcriptionModel.version ? `\n版本：${record.transcriptionModel.version}` : ""}`
    : "这条历史转录没有保存模型信息";
  const selectedModelDiffers = Boolean(effectiveSelectedAsrModel !== record.transcriptionModel?.id);
  return (
    <section className="voice-memory-detail" aria-label="AI 语音记忆">
      <header>
        <div>
          <Sparkles aria-hidden="true" />
          <strong>语音记忆</strong>
          {transcriptionModelLabel ? (
            <span className="voice-memory-model-badge" title={transcriptionModelTitle}>
              转录模型 · {transcriptionModelLabel}
            </span>
          ) : null}
          {record.transcriptionElapsedMs !== undefined ? (
            <span className="voice-memory-model-badge">
              转录耗时 · {formatTranscriptionElapsed(record.transcriptionElapsedMs)}
            </span>
          ) : null}
        </div>
        <span>
          {working
            ? `${record.phase === "transcribing" ? "正在转录" : "正在整理"} ${displayProgress}%`
            : queuedAction
              ? "排队中"
              : record.phase === "ready"
                ? invalidTranscript
                  ? "未识别到可靠语音"
                  : record.errorMessage?.startsWith("organize_failed:")
                    ? "转录完成 · 整理未完成"
                    : record.organizedAt
                      ? "已整理"
                      : "转录完成"
                : record.phase === "error" && transcriptionFinished
                  ? record.processingStage === "organize"
                    ? "转录完成 · 整理失败"
                    : "已保留当前文字 · 可继续"
                  : record.phase === "paused"
                    ? pausedOrganization
                      ? "整理已暂停"
                      : `已暂停 ${displayProgress}%`
                    : "待处理"}
        </span>
        <label className="voice-memory-model-picker">
          <span>转录模型</span>
          <select
            value={effectiveSelectedAsrModel}
            disabled={working || busy}
            aria-label="选择转录模型"
            onChange={(event) => void selectModel(event.target.value as AiAsrModelId)}
          >
            {asrModels.map((model) => {
              const installed = Boolean(model.activeRevision && model.runtimeReady);
              const saved = Boolean(record.transcriptionVariants?.[model.id as AiAsrModelId]);
              return (
                <option key={model.id} value={model.id} disabled={!installed && !saved}>
                  {AI_ASR_MODEL_NAMES[model.id as AiAsrModelId]}
                  {saved ? " · 已有结果" : installed ? "" : " · 未安装"}
                </option>
              );
            })}
          </select>
        </label>
        {record.transcript.length > 0 && !invalidTranscript ? (
          <button
            type="button"
            className="voice-memory-quiet-action"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? <ChevronDown /> : <Eye />}
            {detailsOpen ? "收起内容" : "查看转录"}
          </button>
        ) : null}
        {working ? (
          <button
            type="button"
            onClick={() => void window.desktopApi.ai.pauseTask(record.recordingId)}
          >
            <Pause />
            暂停
          </button>
        ) : (
          <div className="voice-memory-header-actions">
            <button
              type="button"
              className="voice-memory-quiet-action"
              disabled={busy || Boolean(queuedAction)}
              onClick={() => void (resumableTranscription ? resume() : process("transcribe"))}
            >
              {resumableTranscription ? <Play /> : <RotateCcw />}
              {queuedAction === "transcribe"
                ? "排队中"
                : resumableTranscription
                  ? "继续转录"
                  : transcriptionFinished
                    ? selectedModelDiffers
                      ? "用此模型转录"
                      : "重新转录"
                    : "开始转录"}
            </button>
            <button
              type="button"
              className="voice-memory-quiet-action"
              disabled={busy || Boolean(queuedAction) || !transcriptionFinished}
              onClick={() => void (pausedOrganization ? resume() : process("organize"))}
            >
              {pausedOrganization ? <Play /> : <Sparkles />}
              {queuedAction === "organize"
                ? "排队中"
                : pausedOrganization
                  ? "继续整理"
                  : record.organizedAt || organizationFailed
                    ? "重新整理"
                    : "整理内容"}
            </button>
          </div>
        )}
      </header>
      {working ? (
        <div className={`voice-memory-working is-${record.phase}`}>
          <div className="voice-memory-audio-trajectory" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
          <div
            className="voice-memory-progress"
            role="progressbar"
            aria-label={record.phase === "transcribing" ? "转录进度" : "AI 整理进度"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={displayProgress}
          >
            <span style={{ transform: `scaleX(${displayProgress / 100})` }} />
          </div>
        </div>
      ) : null}
      {!working &&
      (invalidTranscript ||
        (record.errorMessage && !record.errorMessage.startsWith("deferred:")) ||
        error) ? (
        <p className="voice-memory-error" role="alert">
          {invalidTranscript
            ? record.errorMessage === "no_reliable_speech"
              ? describeError(record.errorMessage, transcriptionFinished)
              : "这条是旧版空结果，或包含乱码、明显重复内容，已停止展示。请重新转录。"
            : describeError(record.errorMessage ?? error ?? "", transcriptionFinished)}
        </p>
      ) : null}

      {detailsOpen && !invalidTranscript && pendingSpeakers.length ? (
        <div className="voice-memory-speakers">
          <h4>确认说话人</h4>
          {pendingSpeakers.map((speaker) => (
            <div key={speaker.speakerId}>
              <span>{speaker.speakerId}</span>
              <input
                value={speakerNames[speaker.speakerId] ?? ""}
                placeholder="输入好友昵称"
                onChange={(event) =>
                  setSpeakerNames((current) => ({
                    ...current,
                    [speaker.speakerId]: event.target.value,
                  }))
                }
                onKeyDown={(event) =>
                  event.key === "Enter" && void confirmSpeaker(speaker.speakerId)
                }
              />
              <button
                type="button"
                disabled={busy || !speakerNames[speaker.speakerId]?.trim()}
                onClick={() => void confirmSpeaker(speaker.speakerId)}
              >
                确认
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {detailsOpen && !invalidTranscript && record.timeline.length ? (
        <div className="voice-memory-timeline">
          {record.timeline.map((item) => (
            <button type="button" key={item.id} onClick={() => onSeek(item.offsetMs)}>
              <time>{clock(item.offsetMs)}</time>
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      ) : null}
      {detailsOpen && !invalidTranscript && readableTranscript.length ? (
        <div className="voice-memory-transcript">
          <h4>转录</h4>
          {readableTranscript.map((segment) => (
            <button type="button" key={segment.id} onClick={() => onSeek(segment.startMs)}>
              <time>{clock(segment.startMs)}</time>
              <strong>
                {segment.nickname ??
                  (hasMultipleSpeakers ? `${segment.speakerId}（待确认）` : "说话人")}
              </strong>
              <span>{segment.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      {detailsOpen && !invalidTranscript && record.highlights.length ? (
        <div className="voice-memory-highlights">
          <h4>精彩片段</h4>
          {record.highlights.map((item) => (
            <button type="button" key={item.id} onClick={() => onSeek(item.startMs)}>
              <strong>{item.title}</strong>
              <span>
                {clock(item.startMs)} · {item.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {detailsOpen && !invalidTranscript && record.summary.length ? (
        <div className="voice-memory-summary">
          <h4>今晚聊了什么</h4>
          {record.summary.map((item, index) => (
            <button
              type="button"
              key={`${item.text}-${index}`}
              onClick={() => item.sourceStartMs !== undefined && onSeek(item.sourceStartMs)}
            >
              {item.text}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
};
