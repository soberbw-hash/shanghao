import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  FolderOpen,
  FolderSearch,
  Gauge,
  ListChecks,
  MapPin,
  Pause,
  Pencil,
  Play,
  SkipBack,
  SkipForward,
  Star,
  TestTube2,
  Trash2,
} from "lucide-react";

import {
  AI_ASR_MODEL_NAMES,
  hasInvalidVoiceMemoryResult,
  RecordingState,
  type AppSettings,
  type RecordingCleanupReason,
  type RecordingLibraryItem,
  type RecordingLibrarySnapshot,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { Switch } from "../base/Switch";
import { SettingsSection } from "./SettingsSection";
import { VoiceMemoryDetail } from "./VoiceMemoryDetail";
import { ModelTestPanel } from "./ModelTestPanel";
import { useRecordingStore } from "../../store/recordingStore";
import {
  isVoiceMemoryTranscriptionComplete,
  voiceMemoryTranscriptionPercent,
} from "../../features/ai/voiceMemoryPresentation";

interface RecordingLibrarySettingsCardProps {
  isActive?: boolean;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
  pushToast: (toast: {
    tone: "neutral" | "success" | "danger";
    title: string;
    description?: string;
  }) => void;
  openTarget?: { filePath: string; startMs: number; requestId: number };
}

let cachedRecordingLibrary: RecordingLibrarySnapshot | undefined;
let recordingLibraryRequest: Promise<RecordingLibrarySnapshot> | undefined;

export const preloadRecordingLibrary = (): Promise<RecordingLibrarySnapshot> => {
  if (cachedRecordingLibrary) return Promise.resolve(cachedRecordingLibrary);
  if (recordingLibraryRequest) return recordingLibraryRequest;
  recordingLibraryRequest = window.desktopApi.recording
    .list()
    .then((snapshot) => {
      cachedRecordingLibrary = snapshot;
      return snapshot;
    })
    .finally(() => {
      recordingLibraryRequest = undefined;
    });
  return recordingLibraryRequest;
};

type RecordingFilter = "all" | "favorites";
const RECORDING_RENDER_BATCH = 24;

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatBytes = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;

const formatTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const secondsPart = String(safe % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secondsPart}`
    : `${minutes}:${secondsPart}`;
};

const compactTranscriptionModelNames = {
  "qwen3-asr-1.7b-force": "Qwen3-ASR-1.7B + Force",
  "qwen3-asr-0.6b-force": "Qwen3-ASR-0.6B + Force",
  "fun-asr-nano-2512": "Fun-ASR-Nano",
  "glm-asr-nano-2512": "GLM-ASR-Nano",
  "fireredasr2-aed": "FireRedASR2-AED",
  "paraformer-zh": "Paraformer 中文套件",
  "moss-transcribe-diarize-0.9b": "MOSS 0.9B",
  "moss-transcribe-diarize-0.9b-q8_0": "MOSS 0.9B Q8",
  "dolphin-cn-dialect-0.4b": "Dolphin 方言 0.4B",
  "cohere-transcribe-2b": "Cohere Transcribe 2B",
  "ark-asr-3b-q8_0": "ARK-ASR-3B Q8_0",
} as const satisfies Record<keyof typeof AI_ASR_MODEL_NAMES, string>;

const voiceMemoryStatus = (
  record: VoiceMemoryRecord | undefined,
):
  | {
      label: string;
      modelLabel?: string;
      modelTitle?: string;
      progress?: number;
      tone: string;
    }
  | undefined => {
  if (!record) return undefined;
  const progress = voiceMemoryTranscriptionPercent(record);
  const modelLabel = record.transcriptionModel
    ? compactTranscriptionModelNames[record.transcriptionModel.id]
    : record.transcript.length > 0
      ? "模型未知"
      : undefined;
  const modelTitle = record.transcriptionModel
    ? `转录模型：${record.transcriptionModel.name}${record.transcriptionModel.version ? `\n版本：${record.transcriptionModel.version}` : ""}`
    : record.transcript.length > 0
      ? "这条历史转录没有保存模型信息"
      : undefined;
  if (record.phase === "transcribing") {
    return { label: `转录中 ${progress}%`, modelLabel, modelTitle, progress, tone: "is-working" };
  }
  if (record.phase === "organizing") {
    return {
      label: "转录完成 · 正在整理",
      modelLabel,
      modelTitle,
      progress: 100,
      tone: "is-working",
    };
  }
  if (record.phase === "ready") {
    if (record.errorMessage === "no_reliable_speech") {
      return { label: "未检测到可用人声", tone: "is-paused" };
    }
    if (hasInvalidVoiceMemoryResult(record)) {
      return { label: "旧结果需重新转录", tone: "is-error" };
    }
    if (!isVoiceMemoryTranscriptionComplete(record)) {
      return {
        label: record.transcript.length ? `部分转录 ${progress}%` : "转录未完成",
        modelLabel,
        modelTitle,
        progress: progress || undefined,
        tone: "is-paused",
      };
    }
    if (record.errorMessage?.startsWith("organize_failed:")) {
      return {
        label: "转录完成 · 整理未完成",
        modelLabel,
        modelTitle,
        tone: "is-muted",
        progress: 100,
      };
    }
    return { label: "转录完成", modelLabel, modelTitle, progress: 100, tone: "is-ready" };
  }
  if (record.phase === "paused") {
    return {
      label: record.errorMessage?.startsWith("manual_required:long_recording")
        ? "长录音需手动转录"
        : record.errorMessage?.startsWith("deferred:")
          ? "等待后台处理"
          : `已暂停 ${progress}%`,
      progress: progress || undefined,
      modelLabel,
      modelTitle,
      tone: "is-paused",
    };
  }
  if (record.phase === "error") {
    const organizationFailed = record.processingStage === "organize" && record.transcript.length;
    return {
      label: organizationFailed
        ? "转录完成 · 整理失败"
        : record.transcript.length
          ? `已保留当前文字 ${progress}%`
          : "转录失败",
      modelLabel,
      modelTitle,
      progress: organizationFailed ? 100 : progress || undefined,
      tone: "is-error",
    };
  }
  return { label: "等待处理", tone: "is-queued" };
};

const recordingDate = (item: RecordingLibraryItem): Date =>
  new Date(item.createdAt || item.modifiedAt);

const dateLabel = (dateKey: string): string => {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dateKey === DATE_FORMAT.format(today)) return "今天";
  if (dateKey === DATE_FORMAT.format(yesterday)) return "昨天";
  const [year, month, day] = dateKey.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
};

export const RecordingLibrarySettingsCard = ({
  isActive = true,
  settings,
  onChange,
  pushToast,
  openTarget,
}: RecordingLibrarySettingsCardProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const recordingPanelRef = useRef<HTMLElement>(null);
  const [library, setLibrary] = useState<RecordingLibrarySnapshot | undefined>(
    cachedRecordingLibrary,
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [recordingFilter, setRecordingFilter] = useState<RecordingFilter>("all");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackError, setPlaybackError] = useState<string>();
  const [cleanupRecordings, setCleanupRecordings] =
    useState<Array<{ item: RecordingLibraryItem; reason: RecordingCleanupReason }>>();
  const [isScanningRecordings, setIsScanningRecordings] = useState(false);
  const [cleanupScanProgress, setCleanupScanProgress] = useState({ processed: 0, total: 0 });
  const [isCleaningRecordings, setIsCleaningRecordings] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<Set<string>>(() => new Set());
  const [pendingBatchDelete, setPendingBatchDelete] = useState<RecordingLibraryItem[]>();
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [renamingId, setRenamingId] = useState<string>();
  const [renameTitle, setRenameTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renderLimit, setRenderLimit] = useState(RECORDING_RENDER_BATCH);
  const [isLibraryLoading, setIsLibraryLoading] = useState(!cachedRecordingLibrary);
  const recordingState = useRecordingStore((state) => state.status.state);
  const recordingBusy = [
    RecordingState.Preparing,
    RecordingState.Recording,
    RecordingState.Stopping,
    RecordingState.Saving,
  ].includes(recordingState);
  const [pendingSeekMs, setPendingSeekMs] = useState<number>();
  const [voiceMemories, setVoiceMemories] = useState<Record<string, VoiceMemoryRecord>>({});
  const [isModelComparisonOpen, setIsModelComparisonOpen] = useState(false);
  const didUsePreloadedLibraryRef = useRef(Boolean(cachedRecordingLibrary));

  const reload = useCallback(async () => {
    if (typeof window.desktopApi.recording.list !== "function") {
      throw new Error("recording_library_restart_required");
    }
    const next = await preloadRecordingLibrary();
    setLibrary(next);
    setSelectedRecordingIds((current) => {
      const existingIds = new Set(next.items.map((item) => item.id));
      return new Set([...current].filter((id) => existingIds.has(id)));
    });
    setSelectedId((current) =>
      current && next.items.some((item) => item.id === current) ? current : next.items[0]?.id,
    );
  }, []);

  useEffect(() => {
    if (!isActive) return;
    if (didUsePreloadedLibraryRef.current) {
      didUsePreloadedLibraryRef.current = false;
      setIsLibraryLoading(false);
      return;
    }
    let active = true;
    cachedRecordingLibrary = undefined;
    if (!cachedRecordingLibrary) setIsLibraryLoading(true);
    void reload()
      .catch((error) => {
        if (!active) return;
        pushToast({
          tone: "danger",
          title: "录音库读取失败",
          description:
            error instanceof Error && error.message === "recording_library_restart_required"
              ? "请完全退出并重新打开上号，让主进程加载新版录音库。"
              : "请检查保存目录。",
        });
      })
      .finally(() => {
        if (active) setIsLibraryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    isActive,
    pushToast,
    reload,
    settings.recordingLibraryQuotaGb,
    settings.recordingSaveDirectory,
  ]);

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    const unsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((record) => {
      if (!active) return;
      setVoiceMemories((current) => ({ ...current, [record.recordingId]: record }));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !library) return undefined;
    let active = true;
    const loadVoiceMemoryStatuses = () => {
      void window.desktopApi.ai
        .listVoiceMemories()
        .then((records) => {
          if (!active) return;
          setVoiceMemories((current) => {
            const next = { ...current };
            for (const record of records) {
              const existing = next[record.recordingId];
              if (!existing || existing.updatedAt <= record.updatedAt) {
                next[record.recordingId] = record;
              }
            }
            return next;
          });
        })
        .catch(() => undefined);
    };
    const idleId = window.requestIdleCallback?.(loadVoiceMemoryStatuses, { timeout: 600 });
    const timerId =
      idleId === undefined ? window.setTimeout(loadVoiceMemoryStatuses, 80) : undefined;
    return () => {
      active = false;
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [isActive, library]);

  useEffect(() => {
    if (!isActive) return;
    const subscribe = window.desktopApi.recording.onScanWasteProgress;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((progress) => {
      setCleanupScanProgress(progress);
    });
  }, [isActive]);

  useEffect(() => {
    if (isActive) return;
    audioRef.current?.pause();
    setIsPlaying(false);
  }, [isActive]);

  const selected = useMemo(
    () => library?.items.find((item) => item.id === selectedId),
    [library?.items, selectedId],
  );

  useEffect(() => {
    setIsModelComparisonOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!openTarget || !library) return;
    const item = library.items.find((candidate) => candidate.filePath === openTarget.filePath);
    if (!item) {
      pushToast({
        tone: "danger",
        title: "没有找到这条录音",
        description: "录音文件可能已被移动或删除。",
      });
      return;
    }
    setRecordingFilter("all");
    setSelectedId(item.id);
    setPendingSeekMs(openTarget.startMs);
  }, [library, openTarget, pushToast]);

  const visibleItems = useMemo(
    () =>
      (library?.items ?? []).filter((item) => {
        if (recordingFilter === "favorites") return item.isFavorite;
        return true;
      }),
    [library?.items, recordingFilter],
  );

  const groupedItems = useMemo(() => {
    const groups = new Map<string, RecordingLibraryItem[]>();
    for (const item of visibleItems) {
      const key = DATE_FORMAT.format(recordingDate(item));
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [visibleItems]);

  const renderedGroups = useMemo(() => {
    let remaining = renderLimit;
    return groupedItems.flatMap(([dateKey, items]) => {
      if (remaining <= 0) return [];
      const visible = items.slice(0, remaining);
      remaining -= visible.length;
      return [[dateKey, visible] as const];
    });
  }, [groupedItems, renderLimit]);

  useEffect(() => {
    setRenderLimit(RECORDING_RENDER_BATCH);
  }, [recordingFilter, library?.directory]);

  useEffect(() => {
    if (!selectedId) return;
    const index = visibleItems.findIndex((item) => item.id === selectedId);
    if (index >= renderLimit) {
      setRenderLimit(Math.ceil((index + 1) / RECORDING_RENDER_BATCH) * RECORDING_RENDER_BATCH);
    }
  }, [renderLimit, selectedId, visibleItems]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || renderLimit >= visibleItems.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRenderLimit((current) =>
            Math.min(visibleItems.length, current + RECORDING_RENDER_BATCH),
          );
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [renderLimit, visibleItems.length]);

  const recordingCounts = useMemo(
    () => ({
      all: library?.items.length ?? 0,
      favorites: library?.items.filter((item) => item.isFavorite).length ?? 0,
    }),
    [library?.items],
  );

  const recordingNumbers = useMemo(() => {
    const numbered = new Map<string, number>();
    const buckets = new Map<string, RecordingLibraryItem[]>();
    for (const item of library?.items ?? []) {
      const key = DATE_FORMAT.format(recordingDate(item));
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
    for (const items of buckets.values()) {
      [...items]
        .sort(
          (left, right) =>
            recordingDate(left).getTime() - recordingDate(right).getTime() ||
            left.fileName.localeCompare(right.fileName, "zh-CN"),
        )
        .forEach((item, index) => numbered.set(item.id, index + 1));
    }
    return numbered;
  }, [library?.items]);

  const recordingTitle = (item: RecordingLibraryItem): string =>
    item.title && item.title !== item.fileName.replace(/\.m4a$/i, "")
      ? item.title
      : `语音 ${String(recordingNumbers.get(item.id) ?? 1).padStart(2, "0")}`;

  const beginRename = (item: RecordingLibraryItem) => {
    if (recordingBusy) {
      pushToast({ tone: "neutral", title: "录音结束后才能重命名" });
      return;
    }
    setRenamingId(item.recordingId);
    setRenameTitle(recordingTitle(item));
  };

  const commitRename = async (item: RecordingLibraryItem) => {
    if (isRenaming || !renameTitle.trim()) return;
    setIsRenaming(true);
    audioRef.current?.pause();
    try {
      const renamed = await window.desktopApi.recording.rename(item.recordingId, renameTitle);
      setLibrary((current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) =>
                entry.recordingId === renamed.recordingId ? renamed : entry,
              ),
            }
          : current,
      );
      setRenamingId(undefined);
      pushToast({ tone: "success", title: "录音名称已更新" });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "录音重命名失败",
        description:
          error instanceof Error && error.message.includes("invalid_recording_title")
            ? "名称不能为空，也不能包含 Windows 文件名禁用字符。"
            : "文件可能正在处理或被其他程序占用，原文件已保留。",
      });
    } finally {
      setIsRenaming(false);
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError(undefined);
  }, [selected?.mediaUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!cleanupRecordings || isCleaningRecordings) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCleanupRecordings(undefined);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [cleanupRecordings, isCleaningRecordings]);

  useEffect(() => {
    if (!pendingBatchDelete || isDeletingBatch) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingBatchDelete(undefined);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isDeletingBatch, pendingBatchDelete]);

  const chooseDirectory = async () => {
    const directory = await window.desktopApi.recording.chooseDirectory();
    if (!directory) return;
    await onChange({ recordingSaveDirectory: directory });
    pushToast({ tone: "success", title: "录音库位置已更新" });
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !selected) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  const moveSelection = (offset: -1 | 1) => {
    if (!visibleItems.length || !selected) return;
    const currentIndex = visibleItems.findIndex((item) => item.id === selected.id);
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (startIndex + offset + visibleItems.length) % visibleItems.length;
    setSelectedId(visibleItems[nextIndex]?.id);
  };

  const selectRecordingFilter = (nextFilter: RecordingFilter) => {
    setRecordingFilter(nextFilter);
    setSelectedRecordingIds(new Set());
    const nextItem = library?.items.find((item) => {
      if (nextFilter === "favorites") return item.isFavorite;
      return true;
    });
    setSelectedId(nextItem?.id);
  };

  const toggleFavorite = async (item: RecordingLibraryItem) => {
    const nextFavorite = !item.isFavorite;
    try {
      await window.desktopApi.recording.setFavorite(item.filePath, nextFavorite);
      setLibrary((current) =>
        current
          ? {
              ...current,
              items: current.items.map((entry) =>
                entry.id === item.id ? { ...entry, isFavorite: nextFavorite } : entry,
              ),
            }
          : current,
      );
      if (recordingFilter === "favorites" && !nextFavorite) {
        const nextItem = visibleItems.find((entry) => entry.id !== item.id);
        setSelectedId(nextItem?.id);
      }
      pushToast({
        tone: "success",
        title: nextFavorite ? "已收藏录音" : "已取消收藏",
      });
    } catch {
      pushToast({
        tone: "danger",
        title: "收藏状态保存失败",
        description: "录音文件可能已被移动。",
      });
    }
  };

  const showItemInFolder = async (item: RecordingLibraryItem) => {
    try {
      await window.desktopApi.recording.showItemInFolder(item.filePath);
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "无法定位录音文件",
        description:
          error instanceof Error && error.message === "recording_not_found"
            ? "这条录音可能已经被移动或删除，请先刷新录音库。"
            : "请确认录音文件仍然存在，然后重试。",
      });
    }
  };

  const cyclePlaybackRate = () => {
    setPlaybackRate((current) => (current === 1 ? 1.5 : current === 1.5 ? 2 : 1));
  };

  const toggleRecordingSelection = (itemId: string) => {
    setSelectedRecordingIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectedRecordings = useMemo(
    () => (library?.items ?? []).filter((item) => selectedRecordingIds.has(item.id)),
    [library?.items, selectedRecordingIds],
  );

  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selectedRecordingIds.has(item.id));

  const toggleSelectAllVisible = () => {
    setSelectedRecordingIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleItems.forEach((item) => next.delete(item.id));
      else visibleItems.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const confirmBatchDelete = async () => {
    if (!pendingBatchDelete?.length || isDeletingBatch) return;
    const requested = pendingBatchDelete;
    setIsDeletingBatch(true);
    audioRef.current?.pause();
    try {
      if (typeof window.desktopApi.recording.deleteMany !== "function") {
        throw new Error("recording_library_restart_required");
      }
      const result = await window.desktopApi.recording.deleteMany(
        requested.map((item) => item.filePath),
      );
      const deletedPaths = new Set(result.deletedFilePaths);
      const deletedIds = new Set(
        requested.filter((item) => deletedPaths.has(item.filePath)).map((item) => item.id),
      );
      setSelectedRecordingIds(
        (current) => new Set([...current].filter((id) => !deletedIds.has(id))),
      );
      setVoiceMemories((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([recordingId]) => !deletedIds.has(recordingId)),
        ),
      );
      setPendingBatchDelete(undefined);
      await reload();
      if (!selectedRecordingIds.size || result.failed.length === 0) setIsSelectionMode(false);
      pushToast({
        tone: result.failed.length ? "danger" : "success",
        title:
          requested.length === 1
            ? result.failed.length
              ? "录音删除失败"
              : "录音已删除"
            : `已删除 ${result.deletedFilePaths.length} 条录音`,
        description: result.failed.length
          ? `${result.failed.length} 条没有删除，文件仍保留在录音库。`
          : undefined,
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "录音删除失败",
        description:
          error instanceof Error &&
          (error.message.includes("No handler registered") ||
            error.message.includes("recording_library_restart_required"))
            ? "请完全退出并重新打开上号后再试。"
            : "文件可能正在被其他程序占用。",
      });
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const findWasteRecordings = async () => {
    const items = library?.items ?? [];
    if (!items.length || isScanningRecordings) return;
    setIsScanningRecordings(true);
    setCleanupScanProgress({ processed: 0, total: items.length });
    try {
      const scan = await window.desktopApi.recording.scanWaste();
      const candidates = new Map(
        scan.candidates.map((candidate) => [candidate.filePath, candidate]),
      );
      const matches = items.flatMap((item) => {
        const candidate = candidates.get(item.filePath);
        return candidate ? [{ item, reason: candidate.reason }] : [];
      });
      if (!matches.length) {
        pushToast({
          tone: "success",
          title: "没有发现废录音",
          description: scan.protectedCount
            ? `${scan.protectedCount} 条收藏或带标记录音已自动保留。`
            : undefined,
        });
        return;
      }
      setCleanupRecordings(matches);
    } catch {
      pushToast({ tone: "danger", title: "录音检查失败", description: "没有删除任何文件。" });
    } finally {
      setIsScanningRecordings(false);
      setCleanupScanProgress({ processed: 0, total: 0 });
    }
  };

  const cleanWasteRecordings = async () => {
    if (!cleanupRecordings?.length || isCleaningRecordings) return;
    setIsCleaningRecordings(true);
    audioRef.current?.pause();
    try {
      if (typeof window.desktopApi.recording.deleteMany !== "function") {
        throw new Error("recording_library_restart_required");
      }
      const result = await window.desktopApi.recording.deleteMany(
        cleanupRecordings.map(({ item }) => item.filePath),
      );
      const deletedCount = result.deletedFilePaths.length;
      setCleanupRecordings(undefined);
      await reload();
      pushToast({
        tone: deletedCount === cleanupRecordings.length ? "success" : "danger",
        title: `已清理 ${deletedCount} 条废录音`,
        description:
          deletedCount === cleanupRecordings.length
            ? undefined
            : `${cleanupRecordings.length - deletedCount} 条删除失败，已保留在录音库。`,
      });
    } catch {
      pushToast({
        tone: "danger",
        title: "清理没有完成",
        description: "没有确认删除成功的录音都会继续保留。",
      });
    } finally {
      setIsCleaningRecordings(false);
    }
  };

  return (
    <div className="recording-library-page">
      <SettingsSection title="录音库" description="录音、标记和播放进度都保存在本机。">
        <div className="recording-library-utility-bar">
          <div className="recording-library-location-tools">
            <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
            <span className="recording-library-utility-label">存放位置</span>
            <strong
              className="recording-library-location-path"
              title={library?.directory ?? "正在读取…"}
            >
              {library?.directory ?? "正在读取…"}
            </strong>
            <Button
              variant="secondary"
              className="h-9 shrink-0 px-3"
              onClick={() => void chooseDirectory()}
            >
              <MapPin className="size-4" aria-hidden="true" /> 更改
            </Button>
            <Button
              variant="secondary"
              className="h-9 shrink-0 px-3"
              onClick={() => void window.desktopApi.recording.openDirectory()}
            >
              打开
            </Button>
          </div>
          <div
            className="recording-library-cleanup-tools"
            title="先清理五分钟以下、静音或损坏的录音；超过容量上限时，再清理最旧录音。收藏和带标记的录音会保留。"
          >
            <span className="recording-library-usage">
              录音占用 <strong>{formatBytes(library?.totalBytes ?? 0)}</strong>
            </span>
            <label
              className="recording-library-auto-cleanup"
              title="录音保存后自动清理五分钟以下、静音或损坏的录音"
            >
              <span>自动清理</span>
              <Switch
                isChecked={settings.isRecordingWasteAutoCleanupEnabled}
                ariaLabel="自动清理五分钟以下、静音或损坏的录音"
                onChange={(checked) =>
                  void onChange({ isRecordingWasteAutoCleanupEnabled: checked })
                }
              />
            </label>
            <label className="settings-quota-control" title="录音库容量上限">
              <span className="recording-library-quota-label">上限</span>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                aria-label="录音库自动清理容量上限"
                value={settings.recordingLibraryQuotaGb}
                onChange={(event) =>
                  void onChange({
                    recordingLibraryQuotaGb: Math.max(
                      1,
                      Math.min(100, Number(event.target.value) || 20),
                    ),
                  })
                }
              />
              <span>GB</span>
            </label>
            <Button
              variant="secondary"
              className="h-9 shrink-0 px-3"
              title="先清理五分钟以下、静音或损坏的录音；超过上限时，再清理最旧录音"
              disabled={!recordingCounts.all || isScanningRecordings || isSelectionMode}
              onClick={() => void findWasteRecordings()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {isScanningRecordings
                ? cleanupScanProgress.total
                  ? `${cleanupScanProgress.processed}/${cleanupScanProgress.total}`
                  : "检查中"
                : "清理"}
            </Button>
          </div>
        </div>
      </SettingsSection>

      <div className="recording-library-workspace">
        <aside className="recording-library-browser" aria-label="录音列表">
          <div className="recording-browser-head">
            <div>
              <h3>全部录音</h3>
              <p>
                {recordingCounts.all} 条 · {formatBytes(library?.totalBytes ?? 0)}
              </p>
            </div>
            <div className="recording-browser-actions">
              <button
                type="button"
                className={`recording-selection-toggle ${isSelectionMode ? "is-active" : ""}`}
                disabled={!recordingCounts.all || isScanningRecordings}
                onClick={() => {
                  setIsSelectionMode((current) => !current);
                  setSelectedRecordingIds(new Set());
                }}
              >
                <ListChecks aria-hidden="true" />
                {isSelectionMode ? "取消" : "选择"}
              </button>
            </div>
          </div>
          <div className="recording-library-filters" role="group" aria-label="筛选录音">
            {(
              [
                ["all", "全部"],
                ["favorites", "收藏"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={recordingFilter === value ? "is-active" : ""}
                onClick={() => selectRecordingFilter(value)}
              >
                <span>{label}</span>
                <small>{recordingCounts[value]}</small>
              </button>
            ))}
          </div>
          {isSelectionMode ? (
            <div className="recording-bulk-toolbar" role="group" aria-label="批量管理录音">
              <span>已选 {selectedRecordings.length} 条</span>
              <button type="button" onClick={toggleSelectAllVisible}>
                {allVisibleSelected ? "取消全选" : "全选"}
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={!selectedRecordings.length}
                onClick={() => setPendingBatchDelete(selectedRecordings)}
              >
                删除
              </button>
            </div>
          ) : null}
          {isLibraryLoading ? (
            <div className="recording-library-loading" role="status" aria-label="正在读取录音">
              <span>正在读取录音…</span>
              <div className="recording-date-items" aria-hidden="true">
                {Array.from({ length: 6 }, (_, index) => (
                  <div className="recording-date-item recording-item-skeleton" key={index}>
                    <i />
                    <i />
                    <i />
                  </div>
                ))}
              </div>
            </div>
          ) : groupedItems.length ? (
            <div className="recording-library-list">
              {renderedGroups.map(([dateKey, items]) => (
                <section className="recording-date-group" key={dateKey}>
                  <div className="recording-date-heading">
                    <strong>{dateLabel(dateKey)}</strong>
                    <span>{items.length} 条</span>
                  </div>
                  <div className="recording-date-items">
                    {items.map((item) => {
                      const memoryStatus = voiceMemoryStatus(voiceMemories[item.recordingId]);
                      return (
                        <div
                          key={item.id}
                          className={`recording-date-item ${item.id === selectedId ? "is-active" : ""} ${isSelectionMode ? "is-selecting" : ""} ${selectedRecordingIds.has(item.id) ? "is-selected" : ""}`}
                        >
                          {isSelectionMode ? (
                            <button
                              type="button"
                              className="recording-item-check"
                              aria-pressed={selectedRecordingIds.has(item.id)}
                              aria-label={
                                selectedRecordingIds.has(item.id)
                                  ? `取消选择${recordingTitle(item)}`
                                  : `选择${recordingTitle(item)}`
                              }
                              onClick={() => toggleRecordingSelection(item.id)}
                            >
                              {selectedRecordingIds.has(item.id) ? (
                                <Check aria-hidden="true" />
                              ) : null}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="recording-item-select"
                            onClick={() => {
                              if (isSelectionMode) toggleRecordingSelection(item.id);
                              else {
                                setSelectedId(item.id);
                                setIsModelComparisonOpen(false);
                              }
                            }}
                            title={item.fileName}
                          >
                            <span className="recording-item-title">{recordingTitle(item)}</span>
                            <span className="recording-item-meta">
                              录制时间 {TIME_FORMAT.format(recordingDate(item))} ·{" "}
                              {formatBytes(item.fileSize)}
                              {item.markers.length ? ` · ${item.markers.length} 个标记` : ""}
                            </span>
                            {memoryStatus ? (
                              <span className={`recording-item-ai-status ${memoryStatus.tone}`}>
                                <span>{memoryStatus.label}</span>
                                {memoryStatus.modelLabel ? (
                                  <span
                                    className="recording-item-ai-model"
                                    title={memoryStatus.modelTitle}
                                  >
                                    转录模型 · {memoryStatus.modelLabel}
                                  </span>
                                ) : null}
                                {memoryStatus.progress !== undefined ? (
                                  <span
                                    className="recording-item-ai-progress"
                                    role="progressbar"
                                    aria-label={`${recordingTitle(item)}转录进度`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={memoryStatus.progress}
                                  >
                                    <span
                                      style={{
                                        transform: `scaleX(${memoryStatus.progress / 100})`,
                                      }}
                                    />
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className={`recording-item-favorite ${item.isFavorite ? "is-active" : ""}`}
                            aria-label={item.isFavorite ? "取消收藏这条录音" : "收藏这条录音"}
                            title={item.isFavorite ? "取消收藏" : "收藏"}
                            onClick={() => void toggleFavorite(item)}
                          >
                            <Star
                              aria-hidden="true"
                              fill={item.isFavorite ? "currentColor" : "none"}
                            />
                          </button>
                          <button
                            type="button"
                            className="recording-item-show-in-folder"
                            aria-label={`打开${recordingTitle(item)}所在文件夹`}
                            title="在文件夹中定位"
                            onClick={() => void showItemInFolder(item)}
                          >
                            <FolderSearch aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              {renderLimit < visibleItems.length ? (
                <div ref={loadMoreRef} className="h-2" aria-hidden="true" />
              ) : null}
            </div>
          ) : (
            <div className="recording-library-empty">
              {recordingFilter === "favorites"
                ? "还没有收藏录音，可以点录音卡片右上角的星标。"
                : "这个分类里还没有录音。"}
            </div>
          )}
        </aside>

        <section ref={recordingPanelRef} className="recording-library-panel">
          {isLibraryLoading ? (
            <div className="recording-library-empty">正在准备录音详情…</div>
          ) : selected ? (
            <div key={selected.id} className="recording-detail-swap">
              <audio
                ref={audioRef}
                src={selected.mediaUrl}
                preload="metadata"
                onLoadedMetadata={(event) => {
                  setDuration(event.currentTarget.duration || 0);
                  if (pendingSeekMs !== undefined) {
                    event.currentTarget.currentTime = pendingSeekMs / 1_000;
                    setCurrentTime(pendingSeekMs / 1_000);
                    setPendingSeekMs(undefined);
                  }
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  setIsPlaying(false);
                  if (!playbackError && duration > 0) moveSelection(1);
                }}
                onError={(event) => {
                  const mediaError = event.currentTarget.error;
                  setIsPlaying(false);
                  setPlaybackError(
                    `这条录音暂时无法播放，文件仍保存在本地。${mediaError?.code ? `（错误 ${mediaError.code}）` : ""}`,
                  );
                }}
              />
              <div className="recording-player-sticky">
                <div className="recording-player-head">
                  <div className="recording-player-heading min-w-0">
                    {renamingId === selected.recordingId ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          className="min-w-0 flex-1 rounded-xl border border-[#9fc9f5] bg-white/80 px-3 py-2 text-sm font-bold text-[#29435f] outline-none focus:ring-2 focus:ring-[#76b5f5]/30"
                          value={renameTitle}
                          maxLength={120}
                          autoFocus
                          aria-label="录音名称"
                          onChange={(event) => setRenameTitle(event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void commitRename(selected);
                            if (event.key === "Escape") setRenamingId(undefined);
                          }}
                        />
                        <button
                          type="button"
                          className="recording-icon-button"
                          disabled={isRenaming || !renameTitle.trim()}
                          aria-label="保存名称"
                          onClick={() => void commitRename(selected)}
                        >
                          <Check />
                        </button>
                      </div>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="recording-player-title truncate">
                          {dateLabel(DATE_FORMAT.format(recordingDate(selected)))} ·{" "}
                          {recordingTitle(selected)}
                        </div>
                        <button
                          type="button"
                          className="recording-icon-button h-8 w-8 shrink-0"
                          aria-label="重命名录音"
                          title="重命名"
                          disabled={recordingBusy}
                          onClick={() => beginRename(selected)}
                        >
                          <Pencil />
                        </button>
                      </div>
                    )}
                    <div className="recording-player-subtitle">
                      录制时间 {TIME_FORMAT.format(recordingDate(selected))} ·{" "}
                      {formatBytes(selected.fileSize)}
                      {selected.markers.length ? ` · ${selected.markers.length} 个标记` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className={`recording-icon-button ${selected.isFavorite ? "is-favorite" : ""}`}
                      type="button"
                      aria-label={selected.isFavorite ? "取消收藏这条录音" : "收藏这条录音"}
                      onClick={() => void toggleFavorite(selected)}
                      title={selected.isFavorite ? "取消收藏" : "收藏"}
                    >
                      <Star fill={selected.isFavorite ? "currentColor" : "none"} />
                    </button>
                    <button
                      className="recording-icon-button"
                      type="button"
                      aria-label="播放上一条录音"
                      onClick={() => moveSelection(-1)}
                      title="上一条"
                    >
                      <SkipBack />
                    </button>
                    <button
                      className="recording-icon-button is-primary"
                      type="button"
                      aria-label={isPlaying ? "暂停录音" : "播放录音"}
                      onClick={() => void togglePlayback()}
                    >
                      {isPlaying ? <Pause /> : <Play />}
                    </button>
                    <button
                      className="recording-icon-button"
                      type="button"
                      aria-label="播放下一条录音"
                      onClick={() => moveSelection(1)}
                      title="下一条"
                    >
                      <SkipForward />
                    </button>
                    <button
                      className="recording-icon-button"
                      type="button"
                      aria-label="删除录音"
                      onClick={() => setPendingBatchDelete([selected])}
                      title="删除"
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
                <div className="recording-player-controls-row">
                  <span className="recording-player-time">
                    已播 {formatTime(currentTime)} / 总时长 {formatTime(duration)}
                  </span>
                  <div className="recording-timeline-wrap">
                    <input
                      className="recording-timeline"
                      type="range"
                      min={0}
                      max={Math.max(1, duration)}
                      step={0.1}
                      value={Math.min(currentTime, Math.max(1, duration))}
                      aria-label="录音播放进度"
                      style={
                        {
                          "--recording-progress": `${duration ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
                        } as CSSProperties
                      }
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (audioRef.current) audioRef.current.currentTime = next;
                        setCurrentTime(next);
                      }}
                    />
                    {selected.markers.map((marker) => (
                      <button
                        key={marker.id}
                        type="button"
                        className="recording-marker-dot"
                        style={{
                          left: `${duration ? Math.min(100, (marker.offsetMs / 1_000 / duration) * 100) : 0}%`,
                        }}
                        onClick={() => {
                          if (audioRef.current)
                            audioRef.current.currentTime = marker.offsetMs / 1_000;
                        }}
                        title={`标记 ${formatTime(marker.offsetMs / 1_000)}`}
                        aria-label={`跳到标记 ${formatTime(marker.offsetMs / 1_000)}`}
                      />
                    ))}
                  </div>
                  <div className="recording-player-meta-actions">
                    <button
                      type="button"
                      className="recording-rate-button recording-playback-rate-button"
                      onClick={cyclePlaybackRate}
                      aria-label={`当前 ${playbackRate} 倍速，点击切换`}
                      title="切换播放速度"
                    >
                      <Gauge className="h-3.5 w-3.5" />
                      <span>{playbackRate}×</span>
                    </button>
                    <button
                      type="button"
                      className={`recording-rate-button ${isModelComparisonOpen ? "is-active" : ""}`}
                      onClick={() => setIsModelComparisonOpen((current) => !current)}
                      aria-pressed={isModelComparisonOpen}
                      aria-label={isModelComparisonOpen ? "返回录音详情" : "对比这条录音的转录模型"}
                      title={isModelComparisonOpen ? "返回录音详情" : "模型对比"}
                    >
                      <TestTube2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>对比</span>
                    </button>
                  </div>
                </div>
              </div>
              {playbackError ? (
                <div className="recording-player-error" role="alert">
                  {playbackError}
                </div>
              ) : null}
              {isModelComparisonOpen ? (
                <ModelTestPanel
                  key={selected.recordingId}
                  recording={selected}
                  recordingTitle={recordingTitle(selected)}
                  audioDurationMs={duration > 0 ? Math.round(duration * 1_000) : undefined}
                  onClose={() => setIsModelComparisonOpen(false)}
                  onSeek={(offsetMs) => {
                    if (audioRef.current) audioRef.current.currentTime = offsetMs / 1_000;
                    setCurrentTime(offsetMs / 1_000);
                  }}
                />
              ) : (
                <VoiceMemoryDetail
                  recording={selected}
                  roomName="好友语音"
                  selectedAsrModel={settings.aiAsrModel}
                  onSeek={(offsetMs) => {
                    if (audioRef.current) audioRef.current.currentTime = offsetMs / 1_000;
                    setCurrentTime(offsetMs / 1_000);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="recording-library-empty">录音会按房间和日期自动整理在这里。</div>
          )}
        </section>
      </div>
      {cleanupRecordings
        ? createPortal(
            <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-6">
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="clean-recordings-title"
                aria-describedby="clean-recordings-description"
                className="modal-surface relative w-full max-w-[430px] rounded-[26px] p-6"
              >
                <DialogCloseButton
                  className="absolute right-4 top-4"
                  label="取消清理录音"
                  disabled={isCleaningRecordings}
                  onClick={() => setCleanupRecordings(undefined)}
                />
                <h2
                  id="clean-recordings-title"
                  className="pr-12 text-balance text-[22px] font-bold text-[#172235]"
                >
                  清理录音？
                </h2>
                <p
                  id="clean-recordings-description"
                  className="mt-2 text-pretty text-sm leading-6 text-[#66778d]"
                >
                  找到 {cleanupRecordings.length} 条可清理录音：五分钟以下{" "}
                  {cleanupRecordings.filter((entry) => entry.reason === "too_short").length}
                  条、静音 {cleanupRecordings.filter((entry) => entry.reason === "silent").length}
                  条、损坏{" "}
                  {cleanupRecordings.filter((entry) => entry.reason === "unreadable").length}
                  条。预计释放{" "}
                  {formatBytes(
                    cleanupRecordings.reduce((total, entry) => total + entry.item.fileSize, 0),
                  )}
                  。收藏和带标记的录音不会被清理。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={isCleaningRecordings}
                    onClick={() => setCleanupRecordings(undefined)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    disabled={isCleaningRecordings}
                    onClick={() => void cleanWasteRecordings()}
                  >
                    {isCleaningRecordings ? "正在清理…" : "确认清理"}
                  </Button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
      {pendingBatchDelete?.length
        ? createPortal(
            <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-6">
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-recordings-title"
                aria-describedby="delete-recordings-description"
                className="modal-surface relative w-full max-w-[430px] rounded-[26px] p-6"
              >
                <DialogCloseButton
                  className="absolute right-4 top-4"
                  label="取消删除录音"
                  disabled={isDeletingBatch}
                  onClick={() => setPendingBatchDelete(undefined)}
                />
                <h2
                  id="delete-recordings-title"
                  className="pr-12 text-balance text-[22px] font-bold text-[#172235]"
                >
                  {pendingBatchDelete.length === 1
                    ? "删除这条录音？"
                    : `删除选中的 ${pendingBatchDelete.length} 条录音？`}
                </h2>
                <p
                  id="delete-recordings-description"
                  className="mt-2 text-pretty text-sm leading-6 text-[#66778d]"
                >
                  录音文件、转录内容和对应的本地语音记忆会一起删除，删除后无法恢复。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={isDeletingBatch}
                    onClick={() => setPendingBatchDelete(undefined)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    disabled={isDeletingBatch}
                    onClick={() => void confirmBatchDelete()}
                  >
                    {isDeletingBatch ? "正在删除…" : "确认删除"}
                  </Button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
