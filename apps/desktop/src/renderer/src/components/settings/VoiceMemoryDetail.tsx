import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, ChevronDown, Eye, Pause, Play, RotateCcw, Sparkles } from "lucide-react";

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
    return "没有检测到可用人声。这条录音可能接近静音，可以用“清理录音”检查后再决定是否删除。";
  }
  if (message.includes("model_vibevoice_not_installed")) return "需要先下载 VibeVoice 模型。";
  if (message.includes("vibevoice_runtime_unavailable")) return "转录运行环境还没有准备好。";
  if (message.includes("ai_runtime_exit")) {
    return transcriptionFinished
      ? "文字已经转好，自动整理没有完成，可以重新整理。"
      : "上次转录没有完成，可以直接重试。";
  }
  if (message.includes("organize_failed") || message.includes("ai_runtime_timeout")) {
    return "转录文字已经保留，本地整理没有完成；你仍然可以直接查看文字，稍后再点重新整理。";
  }
  if (message.includes("recording_file_unavailable")) return "录音文件已被移动或无法读取。";
  return "转录没有完成，可以直接重试。";
};

/** Presents one recording as a linked transcript, timeline and summary. */
export const VoiceMemoryDetail = ({ recording, roomName, onSeek }: VoiceMemoryDetailProps) => {
  const [record, setRecord] = useState<VoiceMemoryRecord>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setDetailsOpen(false);
    void window.desktopApi.ai.getVoiceMemory(recording.filePath).then((value) => {
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
      if (active && value.recordingId === recording.filePath) {
        setRecord(value);
        if (value.phase === "transcribing" || value.phase === "organizing") setDetailsOpen(true);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [recording.filePath]);

  const process = async (restartTranscription = false) => {
    setBusy(true);
    setError(undefined);
    setDetailsOpen(true);
    try {
      setRecord(
        await window.desktopApi.ai.processRecording({
          recordingId: recording.filePath,
          filePath: recording.filePath,
          roomId: recording.roomId,
          roomName,
          manual: true,
          organize: true,
          restartTranscription,
          markers: recording.markers.map((marker) => ({
            id: marker.id,
            offsetMs: marker.offsetMs,
          })),
        }),
      );
    } catch (cause) {
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
        <button type="button" disabled={busy} onClick={() => void process()}>
          {busy ? "正在启动…" : "开始 AI 整理"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </section>
    );
  }

  const working = record.phase === "transcribing" || record.phase === "organizing";
  const transcriptionFinished = record.transcript.length > 0 && !invalidTranscript;
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
            : record.phase === "ready"
              ? invalidTranscript
                ? "未识别到可靠语音"
                : record.errorMessage?.startsWith("organize_failed:")
                  ? "转录完成 · 整理未完成"
                  : "已整理"
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
        ) : record.phase === "paused" ? (
          <div className="voice-memory-header-actions">
            <button
              type="button"
              onClick={() => void window.desktopApi.ai.resumeTask(record.recordingId)}
            >
              <Play />
              继续
            </button>
            <button type="button" disabled={busy} onClick={() => void process(true)}>
              <RotateCcw />
              重新转录
            </button>
          </div>
        ) : record.phase === "error" || record.phase === "idle" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void process(!transcriptionFinished)}
          >
            <Play />
            {busy ? "正在重试" : transcriptionFinished ? "重新整理" : "重新转录"}
          </button>
        ) : record.phase === "ready" ? (
          <button
            type="button"
            className="voice-memory-quiet-action"
            disabled={busy}
            onClick={() => void process(true)}
          >
            <RotateCcw />
            {busy ? "正在启动" : "重新转录"}
          </button>
        ) : null}
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

      {detailsOpen &&
      !invalidTranscript &&
      record.speakers.some((speaker) => speaker.confidence === "pending") ? (
        <div className="voice-memory-speakers">
          <h4>确认说话人</h4>
          {record.speakers
            .filter((speaker) => speaker.confidence === "pending")
            .map((speaker) => (
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
              <strong>{segment.nickname ?? `${segment.speakerId}（待确认）`}</strong>
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
