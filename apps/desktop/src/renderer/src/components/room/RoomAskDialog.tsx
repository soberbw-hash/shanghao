import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, History, MessageCircleQuestion, Sparkles, Square } from "lucide-react";
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
const ROOM_QUESTION_SUGGESTIONS = [
  "海克斯大乱斗卡莎出装推荐",
  "英雄联盟当前版本亚索怎么出装",
] as const;

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
          <header className="room-ai-header">
            <div className="room-ai-title">
              <span className="room-ai-title-icon" aria-hidden="true">
                <Bot />
                <Sparkles />
              </span>
              <span>
                <h2 id="room-ask-title">上号 AI</h2>
                <small>联网查游戏攻略和资料</small>
              </span>
            </div>
            <DialogCloseButton label="关闭提问浮窗" onClick={closeDialog} />
          </header>

          <div className="room-ask-popover-body">
            {!query.trim() && !pending && !answer && !error ? (
              <section className="room-ai-empty" aria-label="提问建议">
                <strong>今天想问点什么？</strong>
                <div className="room-ai-suggestions">
                  {ROOM_QUESTION_SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => {
                        setQuery(suggestion);
                        window.setTimeout(() => inputRef.current?.focus(), 0);
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {pending || answer || error ? <p className="room-ai-user-question">{query}</p> : null}

            <div className="room-ai-composer" data-pending={pending === "ask" ? "true" : "false"}>
              <MessageCircleQuestion className="room-ai-composer-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                maxLength={500}
                disabled={pending === "ask"}
                aria-label="输入问题"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void ask();
                }}
                placeholder="输入想查的游戏攻略或资料"
              />
              <button
                type="button"
                className="room-ai-send"
                disabled={!query.trim() || Boolean(pending)}
                onClick={() => void ask()}
                aria-label="发送问题"
              >
                <ArrowUp aria-hidden="true" />
              </button>
            </div>
            {pending === "ask" ? (
              <div className="room-ai-working" role="status" aria-live="polite">
                <span className="room-ai-working-icon" aria-hidden="true">
                  <Sparkles />
                </span>
                <span>
                  <strong>
                    {pendingSeconds < 5
                      ? "正在查找相关语音记忆"
                      : pendingSeconds < 15
                        ? "正在整理相关内容"
                        : "正在生成回答，仍在正常处理"}
                  </strong>
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
                    <Bot />
                  </span>
                  上号 AI
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
