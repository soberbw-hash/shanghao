import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Play } from "lucide-react";
import type {
  RecordingBatchDeleteResult,
  RecordingCleanupReason,
  RecordingLibraryItem,
} from "@private-voice/shared";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { RecordingCardMeta } from "./RecordingCardMeta";
import { formatRecordingBytes } from "../../features/recording/recordingSize";

export interface WasteRecordingPreview {
  item: RecordingLibraryItem;
  reason: RecordingCleanupReason;
  durationMs?: number;
  title?: string;
}

export const RecordingCleanupDialog = ({
  entries,
  onClean,
  onClose,
}: {
  entries: WasteRecordingPreview[];
  onClean: (paths: string[]) => Promise<RecordingBatchDeleteResult>;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const running = useRef(false);
  const [checked, setChecked] = useState(
    () => new Set(entries.map((entry) => entry.item.filePath)),
  );
  const [removed, setRemoved] = useState(() => new Set<string>());
  const [preview, setPreview] = useState<RecordingLibraryItem>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const player = audio.current;
    element?.showModal();
    return () => {
      player?.pause();
      element?.close();
    };
  }, []);
  const visible = entries.filter((entry) => !removed.has(entry.item.filePath));
  const titleFor = (item: RecordingLibraryItem) =>
    entries.find((entry) => entry.item.recordingId === item.recordingId)?.title ??
    item.title ??
    item.fileName;
  const selected = visible.filter((entry) => checked.has(entry.item.filePath));
  const clean = async () => {
    if (running.current || !selected.length) return;
    running.current = true;
    setBusy(true);
    setError("");
    audio.current?.pause();
    try {
      const result = await onClean(selected.map((entry) => entry.item.filePath));
      if (result.deletedFilePaths.length === selected.length) onClose();
      else {
        setRemoved((current) => new Set([...current, ...result.deletedFilePaths]));
        setChecked(new Set());
        setPreview(undefined);
        setError(
          `${result.deletedFilePaths.length} 条已移到回收站，其余 ${result.failed.length} 条已保留。文件可能已变化、被收藏或被占用，请重新检查。`,
        );
      }
    } catch {
      setError("清理未确认完成，请核对录音库和回收站后重试；文件已变更时请重新检查。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby="clean-recordings-title"
      aria-describedby="clean-recordings-description"
      className="recording-cleanup-dialog island-panel m-auto w-full max-w-xl rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <header className="flex items-center justify-between gap-3">
        <h2 id="clean-recordings-title" className="text-balance text-lg font-semibold">
          清理废弃录音
        </h2>
        <DialogCloseButton label="取消清理录音" disabled={busy} onClick={onClose} />
      </header>
      <p id="clean-recordings-description" className="my-3 text-pretty text-sm text-slate-500">
        检查不足10分钟和整段静音的录音，可先试听。收藏和带标记的录音不会被清理，选中项移至回收站后可恢复。
      </p>
      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={busy}
            checked={!!visible.length && selected.length === visible.length}
            onChange={(event) =>
              setChecked(
                new Set(event.target.checked ? visible.map((entry) => entry.item.filePath) : []),
              )
            }
          />
          全选
        </label>
        <span className="tabular-nums">
          已选 {selected.length} 条 · 可释放{" "}
          {formatRecordingBytes(selected.reduce((sum, entry) => sum + entry.item.fileSize, 0))}
        </span>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2">
        {visible.map(({ item, reason, durationMs }) => (
          <div
            key={item.recordingId}
            className="flex items-center gap-3 rounded-xl bg-slate-50 p-3"
          >
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                disabled={busy}
                checked={checked.has(item.filePath)}
                aria-label={`清理${titleFor(item)}`}
                onChange={(event) =>
                  setChecked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(item.filePath);
                    else next.delete(item.filePath);
                    return next;
                  })
                }
              />
              <span className="min-w-0">
                <strong className="block truncate text-sm" title={titleFor(item)}>
                  {titleFor(item)}
                </strong>
                <RecordingCardMeta
                  dateTime={item.createdAt}
                  recordedAt={new Date(item.createdAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  duration={durationMs === undefined ? null : durationMs / 1000}
                  bytes={item.fileSize}
                />
              </span>
            </label>
            <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-xs">
              {reason === "too_short" ? "短录音 · 不足10分钟" : "整段静音"}
            </span>
            <Button
              variant="secondary"
              className="h-8 shrink-0 px-2"
              disabled={busy}
              aria-label={`试听${titleFor(item)}`}
              onClick={() => setPreview(item)}
            >
              <Play className="size-3" />
              试听
            </Button>
          </div>
        ))}
      </div>
      <audio
        ref={audio}
        controls
        autoPlay={!!preview}
        preload="none"
        src={preview?.mediaUrl}
        className={preview ? "mt-3 h-10 w-full" : "hidden"}
        aria-label={preview ? `试听${titleFor(preview)}` : "录音试听"}
        onError={() => setError("这条录音暂时无法试听，可以取消勾选并保留。")}
      />
      {error && (
        <p role="alert" className="mt-3 text-pretty text-sm text-red-600">
          {error}
        </p>
      )}
      <footer className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button variant="danger" disabled={busy || !selected.length} onClick={() => void clean()}>
          {busy ? "清理中…" : "移到回收站"}
        </Button>
      </footer>
    </dialog>,
    document.body,
  );
};
