import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  FolderOpen,
  Gauge,
  HardDrive,
  ListChecks,
  MapPin,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
} from "lucide-react";

import {
  hasInvalidVoiceMemoryResult,
  type AppSettings,
  type RecordingCleanupReason,
  type RecordingLibraryItem,
  type RecordingLibrarySnapshot,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";
import { VoiceMemoryDetail } from "./VoiceMemoryDetail";

interface RecordingLibrarySettingsCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
  pushToast: (toast: {
    tone: "neutral" | "success" | "danger";
    title: string;
    description?: string;
  }) => void;
  openTarget?: { filePath: string; startMs: number; requestId: number };
}

type RecordingFilter = "all" | "favorites";

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
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
};

const transcriptionPercent = (record: VoiceMemoryRecord): number =>
  record.phase === "transcribing"
    ? Math.min(100, Math.round((record.progress / 70) * 100))
    : record.transcript.length > 0 || record.phase === "organizing" || record.phase === "ready"
      ? 100
      : 0;

const voiceMemoryStatus = (
  record: VoiceMemoryRecord | undefined,
): { label: string; progress?: number; tone: string } | undefined => {
  if (!record) return undefined;
  const progress = transcriptionPercent(record);
  if (record.phase === "transcribing") {
    return { label: `转录中 ${progress}%`, progress, tone: "is-working" };
  }
  if (record.phase === "organizing") {
    return { label: "转录完成 · 正在整理", progress: 100, tone: "is-working" };
  }
  if (record.phase === "ready") {
    if (record.errorMessage === "no_reliable_speech") {
      return { label: "未检测到可用人声", tone: "is-paused" };
    }
    if (hasInvalidVoiceMemoryResult(record)) {
      return { label: "旧结果需重新转录", tone: "is-error" };
    }
    if (record.errorMessage?.startsWith("organize_failed:")) {
      return { label: "转录完成 · 整理未完成", tone: "is-muted", progress: 100 };
    }
    return { label: "转录完成", progress: 100, tone: "is-ready" };
  }
  if (record.phase === "paused") {
    return {
      label: record.errorMessage?.startsWith("deferred:") ? "等待后台处理" : `已暂停 ${progress}%`,
      progress: progress || undefined,
      tone: "is-paused",
    };
  }
  if (record.phase === "error") {
    return {
      label: record.transcript.length ? "转录完成 · 整理失败" : "转录失败",
      progress: record.transcript.length ? 100 : undefined,
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
  settings,
  onChange,
  pushToast,
  openTarget,
}: RecordingLibrarySettingsCardProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [library, setLibrary] = useState<RecordingLibrarySnapshot>();
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
  const [pendingSeekMs, setPendingSeekMs] = useState<number>();
  const [voiceMemories, setVoiceMemories] = useState<Record<string, VoiceMemoryRecord>>({});

  const reload = useCallback(async () => {
    if (typeof window.desktopApi.recording.list !== "function") {
      throw new Error("recording_library_restart_required");
    }
    const next = await window.desktopApi.recording.list();
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
    void reload().catch((error) =>
      pushToast({
        tone: "danger",
        title: "录音库读取失败",
        description:
          error instanceof Error && error.message === "recording_library_restart_required"
            ? "请完全退出并重新打开上号，让主进程加载新版录音库。"
            : "请检查保存目录。",
      }),
    );
  }, [pushToast, reload, settings.recordingLibraryQuotaGb, settings.recordingSaveDirectory]);

  useEffect(() => {
    let active = true;
    void window.desktopApi.ai.listVoiceMemories().then((records) => {
      if (!active) return;
      setVoiceMemories(Object.fromEntries(records.map((record) => [record.recordingId, record])));
    });
    const unsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((record) => {
      if (!active) return;
      setVoiceMemories((current) => ({ ...current, [record.recordingId]: record }));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const subscribe = window.desktopApi.recording.onScanWasteProgress;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((progress) => {
      setCleanupScanProgress(progress);
    });
  }, []);

  const selected = useMemo(
    () => library?.items.find((item) => item.id === selectedId),
    [library?.items, selectedId],
  );

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
    `语音 ${String(recordingNumbers.get(item.id) ?? 1).padStart(2, "0")}`;

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
          Object.entries(current).filter(([recordingId]) => !deletedPaths.has(recordingId)),
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
        <div className="recording-library-settings-grid">
          <SettingsItemRow label="存放位置" description={library?.directory ?? "正在读取…"}>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void chooseDirectory()}>
                <MapPin className="h-4 w-4" /> 更改
              </Button>
              <Button
                variant="secondary"
                onClick={() => void window.desktopApi.recording.openDirectory()}
              >
                <FolderOpen className="h-4 w-4" /> 打开文件夹
              </Button>
            </div>
          </SettingsItemRow>
          <SettingsItemRow
            label="自动清理上限"
            description={`已用 ${formatBytes(library?.totalBytes ?? 0)}，满额后从最旧录音开始清理。`}
          >
            <label className="settings-quota-control">
              <HardDrive className="h-4 w-4" />
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={settings.recordingLibraryQuotaGb}
                onChange={(event) =>
                  void onChange({
                    recordingLibraryQuotaGb: Math.max(
                      1,
                      Math.min(100, Number(event.target.value) || 10),
                    ),
                  })
                }
              />
              <span>GB</span>
            </label>
          </SettingsItemRow>
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
              <button
                type="button"
                className="recording-clean-short-button"
                disabled={!recordingCounts.all || isScanningRecordings || isSelectionMode}
                onClick={() => void findWasteRecordings()}
                title="检查静音、损坏和过短的废录音"
              >
                <Trash2 aria-hidden="true" />
                {isScanningRecordings
                  ? cleanupScanProgress.total
                    ? `${cleanupScanProgress.processed}/${cleanupScanProgress.total}`
                    : "正在检查"
                  : "清理录音"}
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
          {groupedItems.length ? (
            <div className="recording-library-list">
              {groupedItems.map(([dateKey, items]) => (
                <section className="recording-date-group" key={dateKey}>
                  <div className="recording-date-heading">
                    <strong>{dateLabel(dateKey)}</strong>
                    <span>{items.length} 条</span>
                  </div>
                  <div className="recording-date-items">
                    {items.map((item) => {
                      const memoryStatus = voiceMemoryStatus(voiceMemories[item.filePath]);
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
                            onClick={() =>
                              isSelectionMode
                                ? toggleRecordingSelection(item.id)
                                : setSelectedId(item.id)
                            }
                            title={item.fileName}
                          >
                            <span className="recording-item-title">{recordingTitle(item)}</span>
                            <span className="recording-item-meta">
                              {TIME_FORMAT.format(recordingDate(item))} ·{" "}
                              {formatBytes(item.fileSize)}
                              {item.markers.length ? ` · ${item.markers.length} 个标记` : ""}
                            </span>
                            {memoryStatus ? (
                              <span className={`recording-item-ai-status ${memoryStatus.tone}`}>
                                <span>{memoryStatus.label}</span>
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
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="recording-library-empty">
              {recordingFilter === "favorites"
                ? "还没有收藏录音，可以点录音卡片右上角的星标。"
                : "这个分类里还没有录音。"}
            </div>
          )}
        </aside>

        <section className="recording-library-panel">
          {selected ? (
            <>
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
              <div className="recording-player-head">
                <div className="min-w-0">
                  <div className="recording-player-title">
                    {dateLabel(DATE_FORMAT.format(recordingDate(selected)))} ·{" "}
                    {recordingTitle(selected)}
                  </div>
                  <div className="recording-player-subtitle">
                    {TIME_FORMAT.format(recordingDate(selected))} · {formatBytes(selected.fileSize)}
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
                      if (audioRef.current) audioRef.current.currentTime = marker.offsetMs / 1_000;
                    }}
                    title={`标记 ${formatTime(marker.offsetMs / 1_000)}`}
                    aria-label={`跳到标记 ${formatTime(marker.offsetMs / 1_000)}`}
                  />
                ))}
              </div>
              <div className="recording-player-meta">
                <span>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <button
                  type="button"
                  className="recording-rate-button"
                  onClick={cyclePlaybackRate}
                  aria-label={`当前 ${playbackRate} 倍速，点击切换`}
                  title="切换播放速度"
                >
                  <Gauge className="h-3.5 w-3.5" />
                  <span>{playbackRate}×</span>
                </button>
              </div>
              {playbackError ? (
                <div className="recording-player-error" role="alert">
                  {playbackError}
                </div>
              ) : null}
              <VoiceMemoryDetail
                recording={selected}
                roomName="好友语音"
                onSeek={(offsetMs) => {
                  if (audioRef.current) audioRef.current.currentTime = offsetMs / 1_000;
                  setCurrentTime(offsetMs / 1_000);
                }}
              />
            </>
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
                className="modal-surface w-full max-w-[430px] rounded-[26px] p-6"
              >
                <h2
                  id="clean-recordings-title"
                  className="text-balance text-[22px] font-bold text-[#172235]"
                >
                  清理废录音？
                </h2>
                <p
                  id="clean-recordings-description"
                  className="mt-2 text-pretty text-sm leading-6 text-[#66778d]"
                >
                  找到 {cleanupRecordings.length} 条废录音：静音{" "}
                  {cleanupRecordings.filter((entry) => entry.reason === "silent").length} 条、损坏{" "}
                  {cleanupRecordings.filter((entry) => entry.reason === "unreadable").length}{" "}
                  条、不足 10 秒{" "}
                  {cleanupRecordings.filter((entry) => entry.reason === "too_short").length}
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
                className="modal-surface w-full max-w-[430px] rounded-[26px] p-6"
              >
                <h2
                  id="delete-recordings-title"
                  className="text-balance text-[22px] font-bold text-[#172235]"
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
