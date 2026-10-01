import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, History, Send, Square } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { VoiceMemoryAnswer } from "@private-voice/shared";

import { popoverSurfaceVariants, reducedFadeVariants } from "../../features/motion/motionPresets";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { RoomAiIcon } from "./RoomAiIcon";
import { roomAiError } from "../../features/room/roomAiError";
import { useRoomAiShare } from "../../features/room/useRoomAiShare";

interface RoomAskDialogProps {
  isOpen: boolean;
  reduceMotion: boolean;
  onClose: () => void;
  onOpenResult: (target: { filePath: string; startMs: number }) => void;
  onSendToChat: (content: string, clientMessageId: string) => Promise<void>;
  canSend: boolean;
}

type PendingAction = "ask";

interface RoomQuestionHistoryEntry {
  id: string;
  question: string;
  answer: VoiceMemoryAnswer;
  createdAt: string;
}

const ROOM_QUESTION_HISTORY_KEY = "shanghao:room-question-history:v1";
const ROOM_QUESTION_HISTORY_LIMIT = 10;

const readQuestionHistory = (): RoomQuestionHistoryEntry[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ROOM_QUESTION_HISTORY_KEY) ?? "[]") as
      RoomQuestionHistoryEntry[] | undefined;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry) =>
          typeof entry?.id === "string" &&
          typeof entry.question === "string" &&
          typeof entry.createdAt === "string" &&
          typeof entry.answer?.text === "string" &&
          Array.isArray(entry.answer.sources) &&
          entry.answer.sources.every(
            (source) =>
              typeof source?.startMs === "number" &&
              Number.isFinite(source.startMs) &&
              typeof source.quote === "string",
          ),
      )
      .slice(0, ROOM_QUESTION_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const rememberQuestion = (
  history: RoomQuestionHistoryEntry[],
  question: string,
  answer: VoiceMemoryAnswer,
): RoomQuestionHistoryEntry[] => {
  const next = [
    {
      id: crypto.randomUUID(),
      question,
      answer,
      createdAt: new Date().toISOString(),
    },
    ...history,
  ].slice(0, ROOM_QUESTION_HISTORY_LIMIT);
  try {
    window.localStorage.setItem(ROOM_QUESTION_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // A full or unavailable local store must not block the current answer.
  }
  return next;
};

const formatOffset = (offsetMs: number): string => {
  const seconds = Math.max(0, Math.floor(offsetMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

/** One room-level entry for asking a question without blocking the room. */
export const RoomAskDialog = ({
  isOpen,
  reduceMotion,
  onClose,
  onOpenResult,
  onSendToChat,
  canSend,
}: RoomAskDialogProps) => {
  const sharing = useRoomAiShare(onSendToChat);
  const inputRef = useRef<HTMLInputElement>(null);
  const askSequenceRef = useRef(0);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingAction>();
  const [stopping, setStopping] = useState(false);
  const [pendingSeconds, setPendingSeconds] = useState(0);
  const [answer, setAnswer] = useState<VoiceMemoryAnswer>();
  const [error, setError] = useState<string>();
  const [questionHistory, setQuestionHistory] =
    useState<RoomQuestionHistoryEntry[]>(readQuestionHistory);

  const closeDialog = useCallback(() => {
    if (pending === "ask") {
      askSequenceRef.current += 1;
      void window.desktopApi.ai.cancelQuestion();
      setPending(undefined);
    }
    onClose();
  }, [onClose, pending]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeDialog, isOpen]);

  useEffect(() => {
    if (isOpen || pending !== "ask") return;
    void window.desktopApi.ai.cancelQuestion();
  }, [isOpen, pending]);

  useEffect(() => {
    if (pending !== "ask") {
      setPendingSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const update = () => setPendingSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const ask = async () => {
    const value = query.trim();
    if (!value || pending || sharing.sending) return;
    const sequence = ++askSequenceRef.current;
    setPending("ask");
    setStopping(false);
    setError(undefined);
    setAnswer(undefined);
    sharing.clearNotice();
    try {
      const nextAnswer = await window.desktopApi.ai.askMemory({ question: value });
      if (sequence !== askSequenceRef.current) return;
      if (
        typeof nextAnswer?.text !== "string" ||
        !nextAnswer.text.trim() ||
        !Array.isArray(nextAnswer.sources)
      )
        throw new Error("ai_invalid_json_response");
      setAnswer(nextAnswer);
      setQuestionHistory((current) => rememberQuestion(current, value, nextAnswer));
    } catch (cause) {
      if (sequence !== askSequenceRef.current) return;
      setError(roomAiError(cause));
    } finally {
      if (sequence === askSequenceRef.current) setPending(undefined);
    }
  };

  const stopAsk = async () => {
    if (pending !== "ask" || stopping) return;
    setStopping(true);
    try {
      const stopped = await window.desktopApi.ai.cancelQuestion();
      if (!stopped) return;
      askSequenceRef.current += 1;
      setPending(undefined);
      setError("已经停止这次回答，可以继续使用房间或重新提问。");
    } catch {
      setError("停止回答没有成功，请关闭提问窗口后重试。");
    } finally {
      setStopping(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.aside
          key="room-ask-dialog"
          role="dialog"
          aria-labelledby="room-ask-title"
          className="room-ask-popover"
          variants={reduceMotion ? reducedFadeVariants : popoverSurfaceVariants}
          initial="initial"
          animate="open"
          exit="closed"
        >
          <header className="room-ai-header">
            <div className="room-ai-title">
              <span className="room-ai-title-icon" aria-hidden="true">
                <RoomAiIcon />
              </span>
              <span>
                <h2 id="room-ask-title" className="text-balance">
                  上号 AI
                </h2>
                <small>游戏助手</small>
              </span>
            </div>
            <DialogCloseButton label="关闭提问浮窗" onClick={closeDialog} />
          </header>

          <div className="room-ask-popover-body">
            {pending || answer || error ? <p className="room-ai-user-question">{query}</p> : null}

            <div className="room-ai-composer" data-pending={pending === "ask" ? "true" : "false"}>
              <input
                ref={inputRef}
                value={query}
                maxLength={500}
                disabled={pending === "ask" || sharing.sending}
                aria-label="输入问题"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) void ask();
                }}
                placeholder="输入问题"
              />
              <button
                type="button"
                className="room-ai-send"
                disabled={!query.trim() || Boolean(pending) || sharing.sending}
                onClick={() => void ask()}
                aria-label="发送问题"
              >
                <ArrowUp aria-hidden="true" />
              </button>
            </div>
            {pending === "ask" ? (
              <div className="room-ai-working" role="status" aria-live="polite">
                <span className="room-ai-working-icon" aria-hidden="true">
                  <RoomAiIcon />
                </span>
                <span>
                  <strong>正在回答</strong>
                  <small>
                    {pendingSeconds >= 8
                      ? `已等待 ${pendingSeconds} 秒，可以停止后重新提问。`
                      : "问题已经提交，不需要重复点击。"}
                  </small>
                </span>
              </div>
            ) : null}
            {pending === "ask" ? (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={stopping}
                  onClick={() => void stopAsk()}
                  className="border-[#efcfd2] text-[#c44d57]"
                >
                  <Square className="size-3.5" aria-hidden="true" />
                  {stopping ? "停止中…" : "停止回答"}
                </Button>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 flex items-center gap-3 rounded-[14px] bg-[#fff1f1] px-4 py-3 text-sm font-medium text-[#d94b54]">
                <p className="min-w-0 flex-1">{error}</p>
                {query.trim() ? (
                  <Button variant="secondary" onClick={() => void ask()}>
                    重试
                  </Button>
                ) : null}
              </div>
            ) : null}

            {answer ? (
              <article className="room-ai-answer">
                <h3>
                  <span className="room-ai-answer-icon" aria-hidden="true">
                    <RoomAiIcon />
                  </span>
                  上号 AI
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-pretty text-sm leading-7 text-[#53657b]">
                  {answer.text}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {sharing.notice ? (
                    <p role="status" className="text-xs text-[#718096]">
                      {sharing.notice}
                    </p>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={
                      !canSend || sharing.sending || !answer.text.trim() || Boolean(pending)
                    }
                    onClick={() => void sharing.share(answer.text)}
                  >
                    <Send className="size-3.5" aria-hidden="true" />
                    {sharing.sending ? "发送中…" : "发送到聊天"}
                  </Button>
                </div>
                {answer.sources.length ? (
                  <div className="mt-3 space-y-2 border-t border-[#e2ebf5] pt-3">
                    {answer.sources.map((source, index) => (
                      <button
                        type="button"
                        disabled={!source.filePath}
                        onClick={() =>
                          source.filePath &&
                          onOpenResult({ filePath: source.filePath, startMs: source.startMs })
                        }
                        key={`${source.recordingId ?? source.segmentId}-${source.startMs}-${index}`}
                        className="block w-full rounded-[12px] bg-[#f3f7fc] px-3 py-2 text-left disabled:cursor-default"
                      >
                        <strong className="block text-xs text-[#3974d8]">
                          {source.roomName ?? "语音记录"} · {formatOffset(source.startMs)}
                        </strong>
                        <span className="mt-0.5 block text-xs leading-5 text-[#718096]">
                          {source.quote}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ) : null}

            {questionHistory.length ? (
              <section className="room-question-history" aria-label="最近提问">
                <h3>
                  <History aria-hidden="true" />
                  最近提问
                </h3>
                <div>
                  {questionHistory.map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      disabled={Boolean(pending) || sharing.sending}
                      onClick={() => {
                        setQuery(entry.question);
                        setAnswer(entry.answer);
                        setError(undefined);
                        sharing.clearNotice();
                      }}
                    >
                      <span>{entry.question}</span>
                      <time dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
};
