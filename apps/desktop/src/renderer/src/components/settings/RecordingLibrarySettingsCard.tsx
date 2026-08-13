import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  Gauge,
  HardDrive,
  MapPin,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
} from "lucide-react";

import type {
  AppSettings,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

interface RecordingLibrarySettingsCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
  pushToast: (toast: {
    tone: "neutral" | "success" | "danger";
    title: string;
    description?: string;
  }) => void;
}

type RoomFilter = "all" | "main" | "side" | "favorites";

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

const SHORT_RECORDING_SECONDS = 10;

const readAudioDuration = (mediaUrl: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    const audio = document.createElement("audio");
    let settled = false;
    const finish = (value?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      audio.removeAttribute("src");
      audio.load();
      resolve(value);
    };
    const timeoutId = window.setTimeout(() => finish(), 5_000);
    audio.preload = "metadata";
    audio.addEventListener(
      "loadedmetadata",
      () => finish(Number.isFinite(audio.duration) ? audio.duration : undefined),
      { once: true },
    );
    audio.addEventListener("error", () => finish(), { once: true });
    audio.src = mediaUrl;
    audio.load();
  });

const recordingDate = (item: RecordingLibraryItem): Date =>
  new Date(item.createdAt || item.modifiedAt);

const roomLabel = (item: RecordingLibraryItem): string =>
  item.roomId === "side" || item.fileName.includes("二号房") ? "二号房" : "一号房";

const recordingRoomId = (item: RecordingLibraryItem): "main" | "side" =>
  item.roomId === "side" || item.fileName.includes("二号房") ? "side" : "main";

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
}: RecordingLibrarySettingsCardProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [library, setLibrary] = useState<RecordingLibrarySnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [roomFilter, setRoomFilter] = useState<RoomFilter>("all");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [playbackError, setPlaybackError] = useState<string>();
  const [shortRecordings, setShortRecordings] = useState<RecordingLibraryItem[]>();
  const [isScanningShortRecordings, setIsScanningShortRecordings] = useState(false);
  const [isCleaningShortRecordings, setIsCleaningShortRecordings] = useState(false);

  const reload = useCallback(async () => {
    if (typeof window.desktopApi.recording.list !== "function") {
      throw new Error("recording_library_restart_required");
    }
    const next = await window.desktopApi.recording.list();
    setLibrary(next);
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

  const selected = useMemo(
    () => library?.items.find((item) => item.id === selectedId),
    [library?.items, selectedId],
  );

  const visibleItems = useMemo(
    () =>
      (library?.items ?? []).filter((item) => {
        if (roomFilter === "all") return true;
        if (roomFilter === "favorites") return item.isFavorite;
        return recordingRoomId(item) === roomFilter;
      }),
    [library?.items, roomFilter],
  );

  const groupedItems = useMemo(() => {
    const groups = new Map<string, RecordingLibraryItem[]>();
    for (const item of visibleItems) {
      const key = DATE_FORMAT.format(recordingDate(item));
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [visibleItems]);

  const roomCounts = useMemo(
    () => ({
      all: library?.items.length ?? 0,
      main: library?.items.filter((item) => recordingRoomId(item) === "main").length ?? 0,
      side: library?.items.filter((item) => recordingRoomId(item) === "side").length ?? 0,
      favorites: library?.items.filter((item) => item.isFavorite).length ?? 0,
    }),
    [library?.items],
  );

  const recordingNumbers = useMemo(() => {
    const numbered = new Map<string, number>();
    const buckets = new Map<string, RecordingLibraryItem[]>();
    for (const item of library?.items ?? []) {
      const key = `${DATE_FORMAT.format(recordingDate(item))}:${recordingRoomId(item)}`;
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
    `${roomLabel(item)} ${recordingNumbers.get(item.id) ?? 1}`;

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
    if (!shortRecordings || isCleaningShortRecordings) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShortRecordings(undefined);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isCleaningShortRecordings, shortRecordings]);

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

  const selectRoomFilter = (nextFilter: RoomFilter) => {
    setRoomFilter(nextFilter);
    const nextItem = library?.items.find((item) => {
      if (nextFilter === "all") return true;
      if (nextFilter === "favorites") return item.isFavorite;
      return recordingRoomId(item) === nextFilter;
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
      if (roomFilter === "favorites" && !nextFavorite) {
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

  const removeRecording = async (item: RecordingLibraryItem) => {
    if (pendingDeleteId !== item.id) {
      setPendingDeleteId(item.id);
      window.setTimeout(
        () => setPendingDeleteId((current) => (current === item.id ? undefined : current)),
        4_000,
      );
      return;
    }
    await window.desktopApi.recording.delete(item.filePath);
    setPendingDeleteId(undefined);
    await reload();
    pushToast({ tone: "success", title: "录音已删除" });
  };

  const findShortRecordings = async () => {
    const items = library?.items ?? [];
    if (!items.length || isScanningShortRecordings) return;
    setIsScanningShortRecordings(true);
    try {
      const durations = await Promise.all(
        items.map(async (item) => ({ item, duration: await readAudioDuration(item.mediaUrl) })),
      );
      const matches = durations
        .filter(
          (entry) =>
            typeof entry.duration === "number" &&
            entry.duration >= 0 &&
            entry.duration < SHORT_RECORDING_SECONDS,
        )
        .map((entry) => entry.item);
      if (!matches.length) {
        pushToast({ tone: "success", title: "没有不足 10 秒的录音" });
        return;
      }
      setShortRecordings(matches);
    } finally {
      setIsScanningShortRecordings(false);
    }
  };

  const cleanShortRecordings = async () => {
    if (!shortRecordings?.length || isCleaningShortRecordings) return;
    setIsCleaningShortRecordings(true);
    audioRef.current?.pause();
    let deletedCount = 0;
    try {
      for (const item of shortRecordings) {
        try {
          await window.desktopApi.recording.delete(item.filePath);
          deletedCount += 1;
        } catch {
          // Continue cleaning the remaining verified files and report the partial result below.
        }
      }
      setShortRecordings(undefined);
      await reload();
      pushToast({
        tone: deletedCount === shortRecordings.length ? "success" : "danger",
        title: `已清理 ${deletedCount} 条短录音`,
        description:
          deletedCount === shortRecordings.length
            ? undefined
            : `${shortRecordings.length - deletedCount} 条删除失败，已保留在录音库。`,
      });
    } finally {
      setIsCleaningShortRecordings(false);
    }
  };

  return (
    <div className="space-y-5">
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
                {roomCounts.all} 条 · {formatBytes(library?.totalBytes ?? 0)}
              </p>
            </div>
            <button
              type="button"
              className="recording-clean-short-button"
              disabled={!roomCounts.all || isScanningShortRecordings}
              onClick={() => void findShortRecordings()}
              title="删除所有不足 10 秒的录音"
            >
              <Trash2 aria-hidden="true" />
              {isScanningShortRecordings ? "正在检查" : "清理短录音"}
            </button>
          </div>
          <div className="recording-room-filters" role="group" aria-label="筛选录音">
            {(
              [
                ["all", "全部"],
                ["main", "一号房"],
                ["side", "二号房"],
                ["favorites", "收藏"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={roomFilter === value ? "is-active" : ""}
                onClick={() => selectRoomFilter(value)}
              >
                <span>{label}</span>
                <small>{roomCounts[value]}</small>
              </button>
            ))}
          </div>
          {groupedItems.length ? (
            <div className="recording-library-list">
              {groupedItems.map(([dateKey, items]) => (
                <section className="recording-date-group" key={dateKey}>
                  <div className="recording-date-heading">
                    <strong>{dateLabel(dateKey)}</strong>
                    <span>{items.length} 条</span>
                  </div>
                  <div className="recording-date-items">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`recording-date-item ${item.id === selectedId ? "is-active" : ""}`}
                      >
                        <button
                          type="button"
                          className="recording-item-select"
                          onClick={() => setSelectedId(item.id)}
                          title={item.fileName}
                        >
                          <span className="recording-item-title">{recordingTitle(item)}</span>
                          <span className="recording-item-meta">
                            {TIME_FORMAT.format(recordingDate(item))} · {formatBytes(item.fileSize)}
                            {item.markers.length ? ` · ${item.markers.length} 个标记` : ""}
                          </span>
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
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="recording-library-empty">
              {roomFilter === "favorites"
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
                onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
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
                  <div className="recording-player-title">{recordingTitle(selected)}</div>
                  <div className="recording-player-subtitle">
                    {dateLabel(DATE_FORMAT.format(recordingDate(selected)))} ·{" "}
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
                    className={`recording-icon-button ${pendingDeleteId === selected.id ? "is-confirm" : ""}`}
                    type="button"
                    aria-label={pendingDeleteId === selected.id ? "确认删除录音" : "删除录音"}
                    onClick={() => void removeRecording(selected)}
                    title={pendingDeleteId === selected.id ? "再次点击确认删除" : "删除"}
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
            </>
          ) : (
            <div className="recording-library-empty">录音会按房间和日期自动整理在这里。</div>
          )}
        </section>
      </div>
      {shortRecordings
        ? createPortal(
            <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-6">
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="clean-short-recordings-title"
                aria-describedby="clean-short-recordings-description"
                className="modal-surface w-full max-w-[430px] rounded-[26px] p-6"
              >
                <h2
                  id="clean-short-recordings-title"
                  className="text-balance text-[22px] font-bold text-[#172235]"
                >
                  清理短录音？
                </h2>
                <p
                  id="clean-short-recordings-description"
                  className="mt-2 text-pretty text-sm leading-6 text-[#66778d]"
                >
                  将删除 {shortRecordings.length} 条不足 10 秒的录音，释放约{" "}
                  {formatBytes(shortRecordings.reduce((total, item) => total + item.fileSize, 0))}。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={isCleaningShortRecordings}
                    onClick={() => setShortRecordings(undefined)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    disabled={isCleaningShortRecordings}
                    onClick={() => void cleanShortRecordings()}
                  >
                    {isCleaningShortRecordings ? "正在清理…" : "确认清理"}
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
