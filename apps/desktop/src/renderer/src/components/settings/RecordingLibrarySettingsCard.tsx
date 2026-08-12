import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  FolderOpen,
  Gauge,
  HardDrive,
  MapPin,
  Pause,
  Play,
  SkipForward,
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

const formatBytes = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;

const formatTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
};

const displayName = (item: RecordingLibraryItem): string =>
  item.fileName.replace(/^上号-/, "").replace(/\.m4a$/i, "");

export const RecordingLibrarySettingsCard = ({
  settings,
  onChange,
  pushToast,
}: RecordingLibrarySettingsCardProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [library, setLibrary] = useState<RecordingLibrarySnapshot>();
  const [selectedId, setSelectedId] = useState<string>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();

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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [selected?.mediaUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

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

  const playNext = () => {
    if (!library?.items.length || !selected) return;
    const index = library.items.findIndex((item) => item.id === selected.id);
    setSelectedId(library.items[(index + 1) % library.items.length]?.id);
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

  return (
    <div className="space-y-5">
      <SettingsSection title="录音库" description="录音、标记和播放进度都保存在本机。">
        <div className="space-y-3">
          <SettingsItemRow label="存放位置" description={library?.directory ?? "正在读取…"}>
            <div className="flex gap-2">
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
            description={`已用 ${formatBytes(library?.totalBytes ?? 0)}，超过上限后从最旧的录音开始清理。`}
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
                      Math.min(100, Number(event.target.value) || 5),
                    ),
                  })
                }
              />
              <span>GB</span>
            </label>
          </SettingsItemRow>
        </div>
      </SettingsSection>

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
              onEnded={playNext}
            />
            <div className="recording-player-head">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#26364d]">
                  {displayName(selected)}
                </div>
                <div className="mt-1 text-xs text-[#74839a]">
                  {new Date(selected.modifiedAt).toLocaleString("zh-CN")} ·{" "}
                  {formatBytes(selected.fileSize)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="recording-icon-button"
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
                  onClick={playNext}
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
                />
              ))}
            </div>
            <div className="recording-player-meta">
              <span>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <label>
                <Gauge className="h-3.5 w-3.5" />
                <select
                  value={playbackRate}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                >
                  {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        ) : (
          <div className="recording-library-empty">
            录音会按“一号房 / 二号房 + 时间”自动命名并出现在这里。
          </div>
        )}
      </section>

      {library?.items.length ? (
        <div className="recording-library-list">
          {library.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === selectedId ? "is-active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="truncate">{displayName(item)}</span>
              <span>{formatBytes(item.fileSize)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
