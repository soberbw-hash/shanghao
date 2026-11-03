import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, Trash2 } from "lucide-react";
import type { RecordingRecycleItem } from "@private-voice/shared";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { formatRecordingBytes } from "../../features/recording/recordingSize";

export function RecordingRecycleBinButton({ onRestored }: { onRestored: () => Promise<unknown> }) {
  const api = window.desktopApi.recordingRecycle;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecordingRecycleItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const lifecycle = useRef({ active: false });
  useEffect(() => {
    if (!open || !api) return;
    const owner = { active: true };
    lifecycle.current = owner;
    const element = dialog.current;
    element?.showModal();
    setBusy(true);
    setError("");
    void api
      .list()
      .then((next) => {
        if (owner.active) setItems(next);
      })
      .catch(() => {
        if (owner.active) setError("回收站暂时无法读取，文件已保留。");
      })
      .finally(() => {
        if (owner.active) setBusy(false);
      });
    return () => {
      owner.active = false;
      element?.close();
    };
  }, [open, api]);
  const restore = async (id: string) => {
    if (!api || busy) return;
    const owner = lifecycle.current;
    setBusy(true);
    setError("");
    try {
      await api.restore(id);
      const next = await api.list();
      await onRestored();
      if (owner.active) setItems(next);
    } catch {
      if (owner.active)
        setError("恢复未完成。原位置可能已有同名文件，请移开后重试；已有文件不会被覆盖。");
    } finally {
      if (owner.active) setBusy(false);
    }
  };
  if (!api) return null;
  return (
    <>
      <Button variant="ghost" className="text-xs" onClick={() => setOpen(true)}>
        <Trash2 size={14} />
        回收站
      </Button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="voice-replay-dialog recording-recycle-dialog"
            aria-label="录音回收站"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
            onCancel={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
          >
            <header>
              <div>
                <h2>录音回收站</h2>
                <p>录音及转录保留七天，可恢复。到期后自动永久清除。</p>
              </div>
              <DialogCloseButton label="关闭回收站" onClick={() => setOpen(false)} />
            </header>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            {!items.length && (
              <p className="py-6 text-sm text-slate-500">{busy ? "正在读取…" : "回收站是空的"}</p>
            )}
            <ul className="max-h-[55vh] space-y-2 overflow-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/60 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={item.title}>
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatRecordingBytes(item.fileSize)} ·{" "}
                      {new Date(item.expiresAt).toLocaleDateString("zh-CN")} 到期
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    className="h-8 shrink-0 px-3 text-xs"
                    disabled={busy}
                    onClick={() => void restore(item.id)}
                  >
                    <RotateCcw size={13} />
                    恢复
                  </Button>
                </li>
              ))}
            </ul>
          </dialog>,
          document.body,
        )}
    </>
  );
}
