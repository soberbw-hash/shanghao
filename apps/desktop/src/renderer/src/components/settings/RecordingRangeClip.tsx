import { useEffect, useRef, useState } from "react";
import {
  recordingClipErrorMessage,
  type AppSettings,
  type RecordingLibraryItem,
} from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { useAppStore } from "../../store/appStore";

export type ClipRange = { startMs: number; endMs: number };
export const RecordingRangeClip = ({
  recording,
  range,
  settings,
  onChange,
  onPreview,
}: {
  recording: RecordingLibraryItem;
  range: ClipRange;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void | Promise<void>;
  onPreview: (start: number, end: number) => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [remember, setRemember] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const exporting = useRef(false);
  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);
  const exportClip = async () => {
    if (exporting.current) return;
    exporting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await shanghaoCore.recording.exportClip({
        filePath: recording.filePath,
        ...range,
      });
      useAppStore.getState().pushToast({
        tone: "success",
        title: "片段已导出",
        description: result.fileName,
        clipFilePath: result.filePath,
        persistent: true,
      });
    } catch (e) {
      setError(recordingClipErrorMessage(e));
    } finally {
      exporting.current = false;
      setBusy(false);
    }
  };
  const time = (ms: number) =>
    `${Math.floor(ms / 60_000)}:${((ms % 60_000) / 1_000).toFixed(1).padStart(4, "0")}`;
  return (
    <div className="recording-range-actions">
      <span>
        起点 {time(range.startMs)} · 终点 {time(range.endMs)} · 时长{" "}
        {((range.endMs - range.startMs) / 1000).toFixed(1)} 秒
      </span>
      <button
        type="button"
        onClick={() =>
          void onPreview(range.startMs, range.endMs).catch((e) =>
            setError(recordingClipErrorMessage(e)),
          )
        }
      >
        试听
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          settings.hasDismissedRecordingClipConsent ? void exportClip() : setConfirming(true)
        }
      >
        {busy ? "导出中…" : "导出片段"}
      </button>
      {error && <span role="alert">{error}</span>}
      <dialog
        ref={dialog}
        className="modal-surface recording-clip-consent"
        onCancel={() => setConfirming(false)}
      >
        <h3>导出片段</h3>
        <p>片段包含房间里其他人的声音，发出去之前请确认朋友同意。</p>
        <label>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          不再提示
        </label>
        <div>
          <button type="button" onClick={() => setConfirming(false)}>
            取消
          </button>
          <button
            type="button"
            onClick={() =>
              void (async () => {
                try {
                  if (remember) await onChange({ hasDismissedRecordingClipConsent: true });
                  setConfirming(false);
                  await exportClip();
                } catch {
                  setError("设置未能保存，请重试");
                }
              })()
            }
          >
            确认导出
          </button>
        </div>
      </dialog>
    </div>
  );
};
