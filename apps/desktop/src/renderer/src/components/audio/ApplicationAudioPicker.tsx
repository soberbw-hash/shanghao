import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import {
  AppWindow,
  Check,
  Headphones,
  LoaderCircle,
  RefreshCw,
  SearchX,
  Square,
  Volume2,
} from "lucide-react";
import type { ApplicationAudioSource } from "@private-voice/shared";
import { musicApplicationName } from "@private-voice/shared";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";

interface Props {
  open: boolean;
  sources: ApplicationAudioSource[];
  selectedId: string;
  loading: boolean;
  busy: boolean;
  error: string;
  sharingName?: string;
  gain: number;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onStart: () => void;
  onStop: () => void;
  onGain: (gain: number) => void;
  onClose: () => void;
  returnFocus?: () => void;
}
export const applicationAudioSourceName = (source?: ApplicationAudioSource) =>
  source
    ? (musicApplicationName(source.processName) ??
      (source.processName.replace(/\.exe$/i, "") || source.name))
    : "应用";

export function ApplicationAudioPicker(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selected = props.sources.find((source) => source.id === props.selectedId);
  const close = () => {
    if (props.busy) props.onStop();
    dialog.current?.close();
    props.onClose();
    props.returnFocus?.();
  };
  useEffect(() => {
    if (!props.open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [props.open]);
  if (!props.open) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="application-audio-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="application-audio-heading">
        <span className="application-audio-heading-icon">
          <Headphones size={23} aria-hidden="true" />
        </span>
        <div>
          <h2 id={titleId}>一起听歌</h2>
          <p>选择音乐应用，把正在播放的歌放给朋友听。</p>
        </div>
        <DialogCloseButton label="关闭放歌窗口" onClick={close} />
      </header>
      {props.sharingName ? (
        <section className="application-audio-sharing" aria-label="正在放歌">
          <span className="application-audio-sharing-icon">
            <Volume2 size={36} aria-hidden="true" />
          </span>
          <span className="application-audio-sharing-label">正在放歌</span>
          <h3>{props.sharingName}</h3>
          <p>你可以继续使用麦克风说话。</p>
          <label className="application-audio-gain">
            音乐音量 <output>{Math.round(props.gain * 100)}%</output>
            <input
              aria-label="音乐音量"
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={props.gain}
              onChange={(event) => props.onGain(Number(event.target.value))}
            />
          </label>
        </section>
      ) : (
        <div className="application-audio-picker-body">
          <div className="application-audio-source-heading">
            <h3>音乐应用</h3>
            <Button
              variant="ghost"
              disabled={props.loading || props.busy}
              onClick={props.onRefresh}
              aria-label="刷新音乐应用"
            >
              <RefreshCw size={15} aria-hidden="true" />
              刷新
            </Button>
          </div>
          <div
            className="application-audio-source-list"
            aria-label="可放歌的音乐应用"
            aria-busy={props.loading}
          >
            {props.loading ? (
              <div className="application-audio-empty" role="status">
                <LoaderCircle className="application-audio-spinner" size={27} aria-hidden="true" />
                <strong>正在查找音乐应用…</strong>
              </div>
            ) : props.sources.length ? (
              props.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className={`application-audio-source ${source.id === props.selectedId ? "is-selected" : ""}`}
                  aria-pressed={source.id === props.selectedId}
                  disabled={props.busy}
                  onClick={() => props.onSelect(source.id)}
                >
                  <span className="application-audio-source-icon">
                    {source.appIconDataUrl ? (
                      <img
                        src={source.appIconDataUrl}
                        alt={`${applicationAudioSourceName(source)}图标`}
                        draggable={false}
                      />
                    ) : (
                      <AppWindow size={29} aria-hidden="true" />
                    )}
                  </span>
                  <span className="application-audio-source-copy">
                    <strong>{applicationAudioSourceName(source)}</strong>
                    <span title={source.name}>
                      {/hiddenwindow/i.test(source.name) ? source.processName : source.name}
                    </span>
                  </span>
                  <span className="application-audio-source-check" aria-hidden="true">
                    {source.id === props.selectedId && <Check size={16} />}
                  </span>
                </button>
              ))
            ) : (
              <div className="application-audio-empty">
                <SearchX size={28} aria-hidden="true" />
                <strong>还没有打开音乐应用</strong>
                <p>打开 QQ音乐、网易云音乐、Apple Music 等音乐应用，再刷新。</p>
              </div>
            )}
          </div>
        </div>
      )}
      {props.error && (
        <p className="application-audio-error" role="alert">
          {props.error}
        </p>
      )}
      <footer className="application-audio-footer">
        <span>
          {props.sharingName
            ? "关闭窗口后，音乐会继续播放。"
            : selected
              ? `已选择：${applicationAudioSourceName(selected)}`
              : "麦克风可以同时使用"}
        </span>
        {props.sharingName ? (
          <Button variant="secondary" onClick={props.onStop}>
            <Square size={15} aria-hidden="true" />
            停止放歌
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {props.busy ? "取消开启" : "取消"}
            </Button>
            <Button disabled={!selected || props.loading || props.busy} onClick={props.onStart}>
              <Volume2 size={16} aria-hidden="true" />
              {props.busy ? "正在开启…" : "开始放歌"}
            </Button>
          </>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
