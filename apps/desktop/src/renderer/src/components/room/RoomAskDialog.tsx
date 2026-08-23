import { useCallback, useEffect, useRef, useState } from "react";
import { History, MessageCircleQuestion, Sparkles, Square } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { VoiceMemoryAnswer } from "@private-voice/shared";

import { popoverSurfaceVariants, reducedFadeVariants } from "../../features/motion/motionPresets";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";

interface RoomAskDialogProps {
  isOpen: boolean;
  reduceMotion: boolean;
  onClose: () => void;
  onOpenResult: (target: { filePath: string; startMs: number }) => void;
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

const friendlyError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("model_qwen35-4b_not_installed") ||
    message.includes("qwen_runtime_unavailable")
  )
    return "房间问答已使用云端 API，请完全退出并重新打开上号后再试。";
  if (message.includes("cloud_ai_join_required")) return "请先进入一号房或二号房，再使用云端问答。";
  if (message.includes("cloud_ai_not_configured")) return "房间云端 AI 还没有配置好。";
  if (message.includes("cloud_ai_unsupported"))
    return "房间服务器版本较旧，请更新服务器或切换本地模型。";
  if (message.includes("cloud_ai_busy") || message.includes("cloud_ai_request_in_progress"))
    return "云端 AI 正忙，请稍后再问。";
  if (message.includes("custom_ai_not_configured")) return "请先在 AI 功能中保存自定义 API。";
  if (message.includes("ai_task_paused") || message.includes("cloud_ai_cancelled"))
    return "已经停止这次回答，可以继续使用房间或重新提问。";
  if (message.includes("ai_question_in_progress")) return "上一条问题还在处理，可以先停止它。";
  if (message.includes("waiting_for_game_to_finish"))
    return "当前设置为游戏结束后处理，可以稍后再问。";
  if (message.includes("ai_runtime_exit") || message.includes("qwen_invalid_json_response"))
    return "这次回答没有正常返回，已保留问题，可以直接重试。";
  return "这次没有得到结果，请稍后重试。";
};

/** One room-level entry for asking a question without blocking the room. */
export const RoomAskDialog = ({
  isOpen,
  reduceMotion,
  onClose,
  onOpenResult,
}: RoomAskDialogProps) => {
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
    if (!value || pending) return;
    const sequence = ++askSequenceRef.current;
    setPending("ask");
    setStopping(false);
    setError(undefined);
    setAnswer(undefined);
    try {
      const nextAnswer = await window.desktopApi.ai.askMemory({ question: value });
      if (sequence !== askSequenceRef.current) return;
      setAnswer(nextAnswer);
      setQuestionHistory((current) => rememberQuestion(current, value, nextAnswer));
    } catch (cause) {
      if (sequence !== askSequenceRef.current) return;
      setError(friendlyError(cause));
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
          <header className="flex items-center justify-between gap-3 border-b border-[#dbe8f7]/80 px-4 py-3">
            <h2
              id="room-ask-title"
              className="flex items-center gap-2 text-balance text-sm font-bold text-[#24344b]"
            >
              <Sparkles className="size-4 text-[#4a8de8]" aria-hidden="true" />问
            </h2>
            <DialogCloseButton label="关闭提问浮窗" onClick={closeDialog} />
          </header>

          <div className="room-ask-popover-body">
            <div className="flex items-center gap-3 rounded-[18px] border border-[#ccdef3] bg-white/80 px-4 py-2.5 shadow-[0_12px_30px_rgba(69,104,145,0.08)]">
              <MessageCircleQuestion
                className="size-5 shrink-0 text-[#4a8de8]"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                value={query}
                maxLength={500}
                disabled={pending === "ask"}
                aria-label="输入问题"
                placeholder="想问什么？"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void ask();
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[#24344b] outline-none placeholder:font-normal placeholder:text-[#99a9bb]"
              />
            </div>
            {pending === "ask" ? (
              <div
                className="mt-3 rounded-[14px] border border-[#d7e5f5] bg-white/68 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <strong className="block text-sm text-[#3974bd]">
                  {pendingSeconds < 5
                    ? "正在查找相关语音记忆"
                    : pendingSeconds < 15
                      ? "正在整理相关内容"
                      : "正在生成回答，仍在正常处理"}
                </strong>
                <small className="mt-1 block text-xs text-[#718096]">
                  {pendingSeconds >= 8
                    ? `已等待 ${pendingSeconds} 秒，可以停止后重新提问。`
                    : "问题已经提交，不需要重复点击。"}
                </small>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {pending === "ask" ? (
                <Button
                  variant="secondary"
                  disabled={stopping}
                  onClick={() => void stopAsk()}
                  className="border-[#efcfd2] text-[#c44d57]"
                >
                  <Square className="size-3.5" aria-hidden="true" />
                  {stopping ? "停止中…" : "停止回答"}
                </Button>
              ) : (
                <Button disabled={!query.trim() || Boolean(pending)} onClick={() => void ask()}>
                  <Sparkles className="size-4" aria-hidden="true" />问
                </Button>
              )}
            </div>

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
              <article className="mt-4 rounded-[16px] border border-[#d7e5f5] bg-white/72 p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#26364d]">
                  <Sparkles className="size-4 text-[#4a8de8]" aria-hidden="true" /> 回答
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#53657b]">
                  {answer.text}
                </p>
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
                      onClick={() => {
                        setQuery(entry.question);
                        setAnswer(entry.answer);
                        setError(undefined);
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
