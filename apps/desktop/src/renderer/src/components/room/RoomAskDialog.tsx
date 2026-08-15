import { useEffect, useRef, useState } from "react";
import { BookOpenText, MessageCircleQuestion, Search, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { VoiceMemoryAnswer, VoiceMemorySearchResult } from "@private-voice/shared";

import { popoverSurfaceVariants, reducedFadeVariants } from "../../features/motion/motionPresets";
import { Button } from "../base/Button";

interface RoomAskDialogProps {
  isOpen: boolean;
  reduceMotion: boolean;
  onClose: () => void;
  onOpenResult: (target: { filePath: string; startMs: number }) => void;
}

type PendingAction = "search" | "ask";

const formatOffset = (offsetMs: number): string => {
  const seconds = Math.max(0, Math.floor(offsetMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const friendlyError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("model_qwen35-4b_not_installed"))
    return "需要先在设置的 AI 功能里下载问答模型。";
  if (message.includes("qwen_runtime_unavailable")) return "问答功能正在准备中，稍后再试。";
  if (message.includes("waiting_for_game_to_finish"))
    return "当前设置为游戏结束后处理，可以稍后再问。";
  if (message.includes("ai_runtime_exit") || message.includes("qwen_invalid_json_response"))
    return "这次回答没有正常返回，已保留问题，可以直接重试。";
  return "这次没有得到结果，请稍后重试。";
};

/** One room-level entry for searching local voice memories or asking a question. */
export const RoomAskDialog = ({
  isOpen,
  reduceMotion,
  onClose,
  onOpenResult,
}: RoomAskDialogProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingAction>();
  const [results, setResults] = useState<VoiceMemorySearchResult[]>([]);
  const [answer, setAnswer] = useState<VoiceMemoryAnswer>();
  const [error, setError] = useState<string>();
  const [completedAction, setCompletedAction] = useState<PendingAction>();

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onClose]);

  const search = async () => {
    const value = query.trim();
    if (!value || pending) return;
    setPending("search");
    setError(undefined);
    setCompletedAction(undefined);
    setAnswer(undefined);
    try {
      setResults(await window.desktopApi.ai.searchMemory({ query: value, limit: 30 }));
      setCompletedAction("search");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setPending(undefined);
    }
  };

  const ask = async () => {
    const value = query.trim();
    if (!value || pending) return;
    setPending("ask");
    setError(undefined);
    setCompletedAction(undefined);
    setResults([]);
    setAnswer(undefined);
    try {
      setAnswer(await window.desktopApi.ai.askMemory({ question: value }));
      setCompletedAction("ask");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setPending(undefined);
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
            <div className="min-w-0">
              <h2
                id="room-ask-title"
                className="flex items-center gap-2 text-balance text-sm font-bold text-[#24344b]"
              >
                <Sparkles className="size-4 text-[#4a8de8]" aria-hidden="true" />问
              </h2>
              <p className="mt-0.5 truncate text-xs text-[#7d8da2]">
                {pending === "ask"
                  ? "正在本地思考，可以继续操作房间"
                  : pending === "search"
                    ? "正在查找，可以继续操作房间"
                    : "回答和语音记录都只在本机处理"}
              </p>
            </div>
            <button
              type="button"
              aria-label="关闭提问浮窗"
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-[#dbe8f7] bg-white/80 text-[#718096] transition-colors hover:bg-white hover:text-[#26364d]"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
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
                aria-label="搜索或提问"
                placeholder="例如：上次聊到的显卡是什么？"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void ask();
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[#24344b] outline-none placeholder:font-normal placeholder:text-[#99a9bb]"
              />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                disabled={!query.trim() || Boolean(pending)}
                onClick={() => void search()}
              >
                <Search className="size-4" aria-hidden="true" />
                {pending === "search" ? "搜索中…" : "搜索记忆"}
              </Button>
              <Button disabled={!query.trim() || Boolean(pending)} onClick={() => void ask()}>
                <Sparkles className="size-4" aria-hidden="true" />
                {pending === "ask" ? "正在想…" : "问"}
              </Button>
            </div>

            {error ? (
              <p className="mt-4 rounded-[14px] bg-[#fff1f1] px-4 py-3 text-sm font-medium text-[#d94b54]">
                {error}
              </p>
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

            {results.length ? (
              <section className="mt-4" aria-label="语音记忆搜索结果">
                <h3 className="flex items-center gap-2 text-sm font-bold text-[#26364d]">
                  <BookOpenText className="size-4 text-[#4a8de8]" aria-hidden="true" /> 找到{" "}
                  {results.length} 条
                </h3>
                <div className="mt-2 space-y-2">
                  {results.map((result) => (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenResult({ filePath: result.filePath, startMs: result.startMs })
                      }
                      key={`${result.recordingId}-${result.kind}-${result.startMs}`}
                      className="block w-full rounded-[15px] border border-[#dbe8f7] bg-white/70 px-4 py-3 text-left transition-colors hover:bg-white"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <strong className="truncate text-sm text-[#26364d]">{result.title}</strong>
                        <time className="shrink-0 text-xs font-semibold text-[#4a8de8]">
                          {formatOffset(result.startMs)}
                        </time>
                      </div>
                      <span className="mt-0.5 block text-xs text-[#8a9aaf]">
                        {new Date(result.createdAt).toLocaleDateString("zh-CN")} ·{" "}
                        {result.roomName ?? "房间"}
                      </span>
                      <p className="mt-1 text-sm leading-6 text-[#607187]">{result.excerpt}</p>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {completedAction === "search" && !results.length && !error ? (
              <p className="mt-4 text-center text-sm text-[#93a2b5]">没有找到相关语音记录。</p>
            ) : null}
            {!pending && !completedAction && query.trim() && !error ? (
              <p className="mt-4 text-center text-sm text-[#93a2b5]">选择“搜索记忆”或“问”。</p>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
};
