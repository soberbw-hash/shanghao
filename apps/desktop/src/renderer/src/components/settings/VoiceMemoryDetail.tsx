import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  FileText,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Upload,
} from "lucide-react";

import {
  AI_ASR_MODEL_NAMES,
  buildReadableTranscriptParagraphs,
  hasInvalidVoiceMemoryResult,
  type AiAsrModelId,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import { voiceMemoryTranscriptionPercent } from "../../features/ai/voiceMemoryPresentation";
import { playUiSound } from "../../features/audio/uiSound";

interface VoiceMemoryDetailProps {
  recording: RecordingLibraryItem;
  roomName: string;
  selectedAsrModel: AiAsrModelId;
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

const formatElapsed = (milliseconds?: number): string => {
  if (milliseconds === undefined) return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
};

const formatMemory = (megabytes?: number): string =>
  megabytes === undefined ? "—" : `${(megabytes / 1_024).toFixed(1)} GB`;

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
  if (message.includes("recording_recap_join_matching_room"))
    return "请先进入这条录音对应的房间，再上传整理结果。";
  if (message.includes("recording_recap_join_required"))
    return "请先进入一号房或二号房，再上传整理结果。";
  if (message.includes("recording_recap_unsupported"))
    return "当前房间服务器版本较旧，暂时不能接收整理结果。";
  if (message.includes("recording_recap")) return "上传没有完成，请检查房间连接后重试。";
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
  onSeek,
}: VoiceMemoryDetailProps) => {
  const [record, setRecord] = useState<VoiceMemoryRecord>();
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [queuedAction, setQueuedAction] = useState<"transcribe" | "organize">();
  const [error, setError] = useState<string>();
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const previousPhaseRef = useRef<VoiceMemoryRecord["phase"] | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setQueuedAction(undefined);
    previousPhaseRef.current = undefined;
    void window.desktopApi.ai.getVoiceMemory(recording.recordingId).then((value) => {
      if (!active) return;
      previousPhaseRef.current = value?.phase;
      setRecord(value);
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

  const effectiveSelectedAsrModel = isKnownAsrModelId(selectedAsrModel)
    ? selectedAsrModel
    : DEFAULT_ASR_MODEL_ID;

  const process = async (action: "transcribe" | "organize") => {
    setBusy(true);
    setQueuedAction(action);
    setError(undefined);
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
    try {
      setRecord(await window.desktopApi.ai.resumeTask(recording.recordingId));
    } catch (cause) {
      setQueuedAction(undefined);
      setError(cause instanceof Error ? cause.message : "AI 处理失败");
    } finally {
      setBusy(false);
    }
  };

  const publishOrganization = async () => {
    if (publishing || record?.organization?.status !== "completed") return;
    setPublishing(true);
    setError(undefined);
    try {
      setRecord(await window.desktopApi.ai.publishOrganization(recording.recordingId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传整理结果失败");
    } finally {
      setPublishing(false);
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

  const invalidTranscript = useMemo(
    () => Boolean(record && hasInvalidVoiceMemoryResult(record)),
    [record],
  );
  const displayParagraphs = useMemo(
    () => buildReadableTranscriptParagraphs(record?.transcript ?? []),
    [record?.transcript],
  );
  const knownSpeakerNames = useMemo(
    () =>
      new Map(
        (record?.speakers ?? []).flatMap((speaker) => {
          const name = speaker.nickname?.trim() || speaker.displayNameSnapshot?.trim();
          return name ? [[speaker.speakerId, name] as const] : [];
        }),
      ),
    [record?.speakers],
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

  const processing = record.phase === "transcribing" || record.phase === "organizing";
  const isModelComparisonTask = record.taskId?.startsWith("model-comparison:") === true;
  const comparisonOwnsTask =
    isModelComparisonTask &&
    (record.phase === "transcribing" ||
      record.phase === "paused" ||
      record.taskStatus === "processing" ||
      record.taskStatus === "pending");
  const working = processing && !comparisonOwnsTask;
  const transcriptionFinished = record.transcript.length > 0 && !invalidTranscript;
  const organizationFailed = record.errorMessage?.startsWith("organize_failed:") === true;
  const pausedOrganization = record.phase === "paused" && record.processingStage === "organize";
  const resumableTranscription =
    !comparisonOwnsTask &&
    record.processingStage !== "organize" &&
    (record.phase === "paused" || (record.phase === "error" && transcriptionFinished));
  const hasMultipleSpeakers = record.speakers.length > 1;
  const pendingSpeakers = hasMultipleSpeakers
    ? record.speakers.filter((speaker) => speaker.confidence === "pending")
    : [];
  const displayProgress =
    record.processingStage !== "organize" &&
    (record.transcriptionStats || record.phase === "transcribing" || record.phase === "paused")
      ? voiceMemoryTranscriptionPercent(record)
      : record.progress;
  const organization = record.organization;
  const organizationMetrics = organization?.metrics;
  const organizationProgress = organization?.chunks.length
    ? Math.round((organization.completedChunks / organization.chunks.length) * 100)
    : 0;
  const organizationStatus = organization
    ? organization.status === "completed"
      ? "整理完成"
      : organization.status === "running"
        ? `正在整理 ${organizationProgress}%`
        : organization.status === "paused"
          ? `整理已暂停 ${organizationProgress}%`
          : organization.status === "failed"
            ? `整理未完成 ${organizationProgress}%`
            : "等待整理"
    : undefined;
  return (
    <section className="voice-memory-detail" aria-label="AI 语音记忆">
      <header>
        <div className="voice-memory-title">
          <Sparkles aria-hidden="true" />
          <strong>语音记忆</strong>
        </div>
        {comparisonOwnsTask ? (
          <div className="voice-memory-header-actions">
            <button type="button" className="voice-memory-quiet-action" disabled>
              <Play />
              请在模型对比页面继续
            </button>
          </div>
        ) : working ? (
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
                    ? "重新转录"
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
      {processing ? (
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

      {organization ? (
        <div className={`voice-memory-organization is-${organization.status}`}>
          <div className="voice-memory-organization-overview">
            <div>
              <strong>{organizationStatus}</strong>
              <span>
                Qwen3.6-35B-A3B NVFP4 · {organization.completedChunks}/{organization.chunks.length}{" "}
                块
              </span>
            </div>
            {organization.status === "completed" ? (
              <button
                type="button"
                className="voice-memory-publish-action"
                disabled={publishing || record.organizationPublication?.status === "published"}
                title="点击后才会把整理摘要上传到房间服务器"
                onClick={() => void publishOrganization()}
              >
                {record.organizationPublication?.status === "published" ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Upload aria-hidden="true" />
                )}
                {record.organizationPublication?.status === "published"
                  ? "已上传"
                  : publishing
                    ? "上传中…"
                    : "上传服务器"}
              </button>
            ) : null}
            {organization.finalResult?.participants.length ? (
              <div className="voice-memory-speaking-share" aria-label="说话占比">
                {organization.finalResult.participants.map((participant) => (
                  <span key={participant.speakerId}>
                    {participant.nickname ??
                      knownSpeakerNames.get(participant.speakerId) ??
                      participant.speakerId}
                    <b>{participant.speakingSharePercent ?? 0}%</b>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {organizationMetrics ? (
            <details className="voice-memory-organization-metrics">
              <summary>本次本地整理性能</summary>
              <dl>
                <div>
                  <dt>FreeToken</dt>
                  <dd>{organizationMetrics.providerVersion ?? "版本待回报"}</dd>
                </div>
                <div>
                  <dt>模型加载</dt>
                  <dd>{formatElapsed(organizationMetrics.modelLoadTimeMs)}</dd>
                </div>
                <div>
                  <dt>输入 / 输出</dt>
                  <dd>
                    {organizationMetrics.inputTokens.toLocaleString()} /{" "}
                    {organizationMetrics.outputTokens.toLocaleString()} token
                  </dd>
                </div>
                <div>
                  <dt>首字等待</dt>
                  <dd>{formatElapsed(organizationMetrics.ttftMs)}</dd>
                </div>
                <div>
                  <dt>Prefill</dt>
                  <dd>{formatElapsed(organizationMetrics.prefillTimeMs)}</dd>
                </div>
                <div>
                  <dt>生成速度</dt>
                  <dd>
                    {organizationMetrics.outputTokensPerSecond === undefined
                      ? "—"
                      : `${organizationMetrics.outputTokensPerSecond.toFixed(1)} token/s`}
                  </dd>
                </div>
                <div>
                  <dt>总耗时</dt>
                  <dd>{formatElapsed(organizationMetrics.totalElapsedMs)}</dd>
                </div>
                <div title="优先读取 FreeToken 引擎显存；引擎未提供时才使用 Windows WDDM 启动前后增量">
                  <dt>峰值显存</dt>
                  <dd>{formatMemory(organizationMetrics.peakVramMb)}</dd>
                </div>
                <div>
                  <dt>峰值内存</dt>
                  <dd>{formatMemory(organizationMetrics.peakRamMb)}</dd>
                </div>
                <div>
                  <dt>重试 / OOM</dt>
                  <dd>
                    {organizationMetrics.retryCount} / {organizationMetrics.oomCount}
                  </dd>
                </div>
              </dl>
            </details>
          ) : null}
        </div>
      ) : null}

      {!invalidTranscript && pendingSpeakers.length ? (
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

      {!invalidTranscript && record.timeline.length ? (
        <div className="voice-memory-timeline">
          {record.timeline.map((item) => (
            <button type="button" key={item.id} onClick={() => onSeek(item.offsetMs)}>
              <time>{clock(item.offsetMs)}</time>
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      ) : null}
      {!invalidTranscript && displayParagraphs.length ? (
        <div className="voice-memory-transcript">
          {displayParagraphs.map((paragraph) => (
            <button type="button" key={paragraph.id} onClick={() => onSeek(paragraph.startMs)}>
              <time>{clock(paragraph.startMs)}</time>
              <strong>
                {paragraph.nickname ??
                  paragraph.displayNameSnapshot ??
                  knownSpeakerNames.get(paragraph.speakerId) ??
                  (hasMultipleSpeakers ? `${paragraph.speakerId}（待确认）` : "说话人")}
              </strong>
              <span>{paragraph.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      {!invalidTranscript && record.highlights.length ? (
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
      {!invalidTranscript && record.summary.length ? (
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
