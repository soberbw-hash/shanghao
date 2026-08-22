import { useEffect, useMemo, useState } from "react";
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
  hasInvalidVoiceMemoryResult,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

interface VoiceMemoryDetailProps {
  recording: RecordingLibraryItem;
  roomName: string;
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

const transcriptionPercent = (record: VoiceMemoryRecord): number =>
  record.phase === "transcribing"
    ? Math.min(100, Math.round((record.progress / 70) * 100))
    : record.transcript.length > 0 || record.phase === "organizing" || record.phase === "ready"
      ? 100
      : 0;

const describeError = (message: string, transcriptionFinished: boolean): string => {
  if (message.includes("no_reliable_speech")) {
    return "没有检测到可靠的中文语音；模型返回的其他语言结果已被拦截，请重新转录。";
  }
  if (message.includes("model_vibevoice_not_installed"))
    return "当前选择的 VibeVoice 转录模型还没有下载。";
  if (message.includes("model_qwen3-asr-0.6b_not_installed"))
    return "当前选择的 Qwen3-ASR 转录模型还没有下载。";
  if (message.includes("model_paraformer-zh_not_installed"))
    return "当前选择的 Paraformer 中文套件还没有下载。";
  if (message.includes("_runtime_not_ready"))
    return "当前转录模型的运行组件还没有准备好，请到“AI 功能”中修复组件。";
  if (message.includes("ffmpeg_missing"))
    return "找不到 FFmpeg，无法把录音转换为 ASR 输入格式。请重新安装当前版本。";
  if (message.includes("ffmpeg_failed")) return "音频格式转换失败：" + message;
  if (message.includes("wav_invalid") || message.includes("unsupported_transcription_wav")) {
    return "ASR 输入 WAV 格式不兼容：" + message;
  }
  if (message.includes("dll_missing") || message.includes("0xc0000135")) {
    return "ASR 运行库缺失：" + message;
  }
  if (message.includes("ai_runtime_spawn_failed")) return "AI 进程启动失败：" + message;
  if (message.includes("vibevoice_runtime_unavailable")) return "转录运行环境还没有准备好。";
  if (message.includes("ai_runtime_exit")) {
    return transcriptionFinished
      ? "文字已经转好，自动整理没有完成，可以重新整理。"
      : "上次转录没有完成，可以直接重试。";
  }
  if (message.includes("qwen_worker_timeout")) {
    return "本地千问整理耗时较长，已超过本次等待时间；转录文字已经保留，请稍后重新整理。";
  }
  if (message.includes("manual_required:long_recording")) {
    return "这条录音超过 30 分钟，为避免无人操作时长期占用电脑，已停止自动转录。需要时请点“继续”。";
  }
  if (message.includes("ai_task_paused")) return "任务已暂停，需要时可以继续处理。";
  if (message.includes("voice_memory_transcript_required")) return "请先完成转录，再整理内容。";
  if (message.includes("organize_failed") || message.includes("ai_runtime_timeout")) {
    return "转录文字已经保留，本地整理没有完成；你仍然可以直接查看文字，稍后再点重新整理。";
  }
  if (message.includes("recording_file_unavailable")) return "录音文件已被移动或无法读取。";
  return message ? "转录没有完成：" + message : "转录没有完成，可以直接重试。";
};

/** Presents one recording as a linked transcript, timeline and summary. */
export const VoiceMemoryDetail = ({ recording, roomName, onSeek }: VoiceMemoryDetailProps) => {
  const [record, setRecord] = useState<VoiceMemoryRecord>();
  const [busy, setBusy] = useState(false);
  const [queuedAction, setQueuedAction] = useState<"transcribe" | "organize">();
  const [error, setError] = useState<string>();
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setQueuedAction(undefined);
    setDetailsOpen(false);
    void window.desktopApi.ai.getVoiceMemory(recording.recordingId).then((value) => {
      if (!active) return;
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

  const invalidTranscript = useMemo(
    () => Boolean(record && hasInvalidVoiceMemoryResult(record)),
    [record],
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
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  }

  const working = record.phase === "transcribing" || record.phase === "organizing";
  const transcriptionFinished = record.transcript.length > 0 && !invalidTranscript;
  const organizationFailed = record.errorMessage?.startsWith("organize_failed:") === true;
  const pausedOrganization = record.phase === "paused" && record.processingStage === "organize";
  const hasMultipleSpeakers = record.speakers.length > 1;
  const pendingSpeakers = hasMultipleSpeakers
    ? record.speakers.filter((speaker) => speaker.confidence === "pending")
    : [];
  const displayProgress =
    record.phase === "transcribing" ? transcriptionPercent(record) : record.progress;
  return (
    <section className="voice-memory-detail" aria-label="AI 语音记忆">
      <header>
        <div>
          <Sparkles aria-hidden="true" />
          <strong>语音记忆</strong>
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
                  ? "转录完成 · 整理失败"
                  : record.phase === "paused"
                    ? "已暂停"
                    : "待处理"}
        </span>
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
              onClick={() =>
                void (record.phase === "paused" && !pausedOrganization
                  ? resume()
                  : process("transcribe"))
              }
            >
              {record.phase === "paused" && !pausedOrganization ? <Play /> : <RotateCcw />}
              {queuedAction === "transcribe"
                ? "排队中"
                : record.phase === "paused" && !pausedOrganization
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
      {working ? (
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
      {detailsOpen && !invalidTranscript && record.transcript.length ? (
        <div className="voice-memory-transcript">
          <h4>转录</h4>
          {record.transcript.map((segment) => (
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
