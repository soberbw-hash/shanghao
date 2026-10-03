import { useEffect, useRef, useState } from "react";
import { Copy, MonitorOff, RefreshCw } from "lucide-react";
import type { ScreenCaptureSourceDescriptor } from "@private-voice/shared";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import {
  DEFAULT_SCREEN_SHARE_QUALITY,
  type ScreenShareQuality,
  type ScreenShareTransitionOrigin,
} from "../../features/screen-share/types";

interface ScreenSourcePickerProps {
  isOpen: boolean;
  reduceMotion: boolean;
  sources: ScreenCaptureSourceDescriptor[];
  status: "loading" | "ready" | "empty" | "error";
  includeSystemAudio: boolean;
  onIncludeSystemAudioChange: (value: boolean) => void;
  onSelect: (
    sourceId: string,
    quality: ScreenShareQuality,
    origin: ScreenShareTransitionOrigin,
  ) => void;
  onRetry: () => void;
  onClose: () => void;
  onInvite?: () => void;
}

export const ScreenSourcePicker = ({
  isOpen,
  reduceMotion,
  sources,
  status,
  includeSystemAudio,
  onIncludeSystemAudioChange,
  onSelect,
  onRetry,
  onClose,
  onInvite,
}: ScreenSourcePickerProps) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const [kind, setKind] = useState<"window" | "screen">("window");
  const [selectedId, setSelectedId] = useState<string>();
  const [quality, setQuality] = useState<ScreenShareQuality>(DEFAULT_SCREEN_SHARE_QUALITY);
  const selected = sources.find((source) => source.id === selectedId);
  const visible = sources.filter((source) => source.kind === kind);
  useEffect(() => {
    if (!isOpen) return;
    submitting.current = false;
    setSelectedId(undefined);
    setQuality(DEFAULT_SCREEN_SHARE_QUALITY);
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, [isOpen]);
  const start = () => {
    if (status !== "ready" || !selected || submitting.current) return;
    const bounds = preview.current?.getBoundingClientRect();
    if (!bounds) return;
    submitting.current = true;
    onSelect(selected.id, quality, {
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      width: bounds.width,
      height: bounds.height,
    });
  };
  if (!isOpen) return null;
  return (
    <dialog
      ref={dialog}
      className={`screen-source-picker-panel screen-source-picker-confirm modal-surface ${reduceMotion ? "reduce-motion" : ""}`}
      aria-labelledby="screen-source-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <div>
          <h2 id="screen-source-title">分享哪个画面？</h2>
          <p>先选画面，再开始分享。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={onRetry}
            disabled={status === "loading"}
            aria-label="重新读取画面"
            title="刷新窗口列表"
          >
            <RefreshCw size={17} />
          </Button>
          <DialogCloseButton label="取消屏幕分享" onClick={onClose} />
        </div>
      </header>
      <div className="screen-source-picker-body">
        <div className="screen-source-category" aria-label="画面类型">
          {(["window", "screen"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              className={kind === value ? "active" : ""}
              onClick={() => {
                setKind(value);
                setSelectedId(undefined);
              }}
            >
              {value === "window" ? "应用窗口" : "整个屏幕"}
              <span>{sources.filter((source) => source.kind === value).length}</span>
            </button>
          ))}
        </div>
        <div className="screen-source-picker-layout">
          <div className="screen-source-picker-grid">
            {status === "loading" && (
              <div className="screen-source-picker-loading" role="status">
                <span aria-hidden="true" />
                <strong>正在读取可分享的窗口…</strong>
              </div>
            )}
            {status === "empty" || status === "error" ? (
              <div className="screen-source-picker-loading" role="status">
                <MonitorOff size={28} aria-hidden="true" />
                <strong>{status === "empty" ? "没有找到可分享的画面" : "画面来源读取失败"}</strong>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={onRetry}>
                    重新读取
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void window.desktopApi.app.openSystemSettings("display")}
                  >
                    打开显示设置
                  </Button>
                </div>
              </div>
            ) : null}
            {status === "ready" && !visible.length && (
              <div className="screen-source-picker-loading" role="status">
                <strong>{kind === "window" ? "没有可分享的应用窗口" : "没有可分享的屏幕"}</strong>
              </div>
            )}
            {visible.map((source) => (
              <button
                key={source.id}
                type="button"
                className={`screen-source-picker-item ${selectedId === source.id ? "is-selected" : ""}`}
                aria-pressed={selectedId === source.id}
                disabled={status !== "ready"}
                onClick={() => setSelectedId(source.id)}
              >
                <span className="screen-source-thumbnail">
                  {source.thumbnailDataUrl ? (
                    <img src={source.thumbnailDataUrl} alt="" decoding="async" draggable={false} />
                  ) : (
                    <MonitorOff size={25} aria-hidden="true" />
                  )}
                </span>
                <span className="screen-source-name">
                  {source.appIconDataUrl && (
                    <img
                      src={source.appIconDataUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                    />
                  )}
                  <span>{source.displayLabel ?? source.name}</span>
                </span>
              </button>
            ))}
          </div>
          <aside className="screen-source-confirm-preview">
            <div ref={preview} className="screen-source-confirm-image">
              {selected?.thumbnailDataUrl ? (
                <img
                  src={selected.thumbnailDataUrl}
                  alt={`预览：${selected.name}`}
                  decoding="async"
                  draggable={false}
                />
              ) : (
                <MonitorOff size={30} aria-hidden="true" />
              )}
            </div>
            <strong>{selected?.name ?? "选择一个画面"}</strong>
            <div className="screen-source-quality" aria-label="分享清晰度">
              {(["720p", "1080p", "1440p"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={quality === value ? "active" : ""}
                  aria-pressed={quality === value}
                  onClick={() => setQuality(value)}
                >
                  {value === "1440p" ? "2K" : value}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`screen-audio-toggle ${includeSystemAudio ? "active" : ""}`}
              aria-pressed={includeSystemAudio}
              onClick={() => onIncludeSystemAudioChange(!includeSystemAudio)}
            >
              <span aria-hidden="true">{includeSystemAudio ? "✓" : ""}</span>分享系统声音
            </button>
            <small>开启后包含整台电脑的声音。</small>
          </aside>
        </div>
      </div>
      <footer className="screen-source-confirm-footer">
        {onInvite && (
          <Button variant="ghost" onClick={onInvite}>
            <Copy size={15} aria-hidden="true" />
            复制房间邀请
          </Button>
        )}
        <Button disabled={!selected || status !== "ready"} onClick={start}>
          开始分享
        </Button>
      </footer>
    </dialog>
  );
};
