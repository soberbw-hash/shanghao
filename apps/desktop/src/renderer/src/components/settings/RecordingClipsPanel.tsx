import { useEffect, useRef, useState } from "react";
import { Download, FolderSearch, GripVertical, Play } from "lucide-react";
import {
  RECORDING_CLIP_PRESETS,
  recordingClipErrorMessage,
  recordingClipWindow,
  type AppSettings,
  type RecordingClipResult,
  type RecordingLibraryItem,
} from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { useAppStore } from "../../store/appStore";
import { Button } from "../base/Button";

const timestamp = (ms: number) =>
  [Math.floor(ms / 3_600_000), Math.floor(ms / 60_000) % 60, Math.floor(ms / 1_000) % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
export const RecordingClipsPanel = ({
  recording,
  durationMs,
  settings,
  onChange,
  onPreview,
}: {
  recording: RecordingLibraryItem;
  durationMs: number;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void | Promise<void>;
  onPreview: (startMs: number, endMs: number) => Promise<void>;
}) => {
  const [before, setBefore] = useState(settings.recordingClipBeforeMs / 1_000);
  const [after, setAfter] = useState(settings.recordingClipAfterMs / 1_000);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [result, setResult] = useState<RecordingClipResult>();
  const [consentMarker, setConsentMarker] = useState<string>();
  const [doNotAsk, setDoNotAsk] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (consentMarker) element?.showModal();
    return () => element?.close();
  }, [consentMarker]);
  const beforeMs = Math.round(before * 1_000),
    afterMs = Math.round(after * 1_000);
  const valid =
    Number.isFinite(before) &&
    Number.isFinite(after) &&
    before >= 0 &&
    after >= 0 &&
    beforeMs + afterMs >= 3_000 &&
    beforeMs + afterMs <= 120_000;
  const preset =
    Object.entries(RECORDING_CLIP_PRESETS).find(
      ([, value]) => value.beforeMs === beforeMs && value.afterMs === afterMs,
    )?.[0] ?? "custom";
  const saveWindow = async (nextBefore = beforeMs, nextAfter = afterMs) => {
    try {
      await onChange({ recordingClipBeforeMs: nextBefore, recordingClipAfterMs: nextAfter });
    } catch {
      if (active.current) setError("时长设置未能保存，请重试");
    }
  };
  const exportMarker = async (markerId: string) => {
    if (!valid || inFlight.current.has(markerId)) return;
    inFlight.current.add(markerId);
    setBusy(new Set(inFlight.current));
    setError("");
    try {
      const clip = await shanghaoCore.recording.exportClip({
        filePath: recording.filePath,
        markerId,
        beforeMs,
        afterMs,
      });
      if (active.current) setResult(clip);
      useAppStore.getState().pushToast({
        tone: "success",
        title: "已导出名场面",
        description: clip.fileName,
        clipFilePath: clip.filePath,
        persistent: true,
      });
    } catch (error) {
      const description = recordingClipErrorMessage(error);
      if (active.current) setError(description);
      useAppStore.getState().pushToast({ tone: "danger", title: "名场面未导出", description });
    } finally {
      inFlight.current.delete(markerId);
      if (active.current) setBusy(new Set(inFlight.current));
    }
  };
  const preview = async (offsetMs: number) => {
    setError("");
    try {
      const segment = recordingClipWindow(offsetMs, durationMs, beforeMs, afterMs);
      await onPreview(segment.startMs, segment.endMs);
    } catch (error) {
      setError(recordingClipErrorMessage(error));
    }
  };
  if (!recording.markers.length) return null;
  return (
    <section className="recording-clips-panel" aria-label="精彩时刻">
      <div className="recording-clips-heading">
        <h3>
          精彩时刻 <span>{recording.markers.length} 个</span>
        </h3>
        <label>
          截取时长{" "}
          <select
            value={preset}
            onChange={(event) => {
              const value =
                RECORDING_CLIP_PRESETS[event.target.value as keyof typeof RECORDING_CLIP_PRESETS];
              if (!value) return;
              setBefore(value.beforeMs / 1_000);
              setAfter(value.afterMs / 1_000);
              void saveWindow(value.beforeMs, value.afterMs);
            }}
          >
            <option value="short">短 · 前 10 秒 / 后 5 秒</option>
            <option value="standard">标准 · 前 20 秒 / 后 8 秒</option>
            <option value="long">长 · 前 40 秒 / 后 15 秒</option>
            <option value="custom" disabled>
              自定义
            </option>
          </select>
        </label>
      </div>
      <div className="recording-clips-range">
        <label>
          标记前{" "}
          <input
            type="number"
            min="0"
            max="120"
            step="1"
            value={Number.isFinite(before) ? before : ""}
            onChange={(e) => setBefore(e.target.value === "" ? NaN : Number(e.target.value))}
            onBlur={() => {
              if (valid) void saveWindow();
            }}
          />{" "}
          秒
        </label>
        <label>
          标记后{" "}
          <input
            type="number"
            min="0"
            max="120"
            step="1"
            value={Number.isFinite(after) ? after : ""}
            onChange={(e) => setAfter(e.target.value === "" ? NaN : Number(e.target.value))}
            onBlur={() => {
              if (valid) void saveWindow();
            }}
          />{" "}
          秒
        </label>
        <span>{valid ? "M4A · 仅保存在本机" : "片段时长须为 3–120 秒"}</span>
      </div>
      <div className="recording-clips-markers">
        {recording.markers.map((marker) => (
          <div key={marker.id} className="recording-clip-row">
            <time>{timestamp(marker.offsetMs)}</time>
            <Button
              variant="ghost"
              disabled={!valid || durationMs <= 0}
              onClick={() => void preview(marker.offsetMs)}
            >
              <Play />
              试听
            </Button>
            <Button
              variant="secondary"
              disabled={!valid || busy.has(marker.id)}
              onClick={() => {
                if (settings.hasDismissedRecordingClipConsent) void exportMarker(marker.id);
                else setConsentMarker(marker.id);
              }}
            >
              <Download />
              {busy.has(marker.id) ? "排队 / 导出中…" : "导出"}
            </Button>
          </div>
        ))}
      </div>
      {error && (
        <p className="recording-clips-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div
          className="recording-clip-result"
          draggable
          onDragStart={(e) => {
            e.preventDefault();
            shanghaoCore.recording.dragClip(result.filePath);
          }}
        >
          <GripVertical />
          <span>
            {result.fileName}
            <small>拖到聊天软件发送</small>
          </span>
          <Button
            variant="ghost"
            onClick={() =>
              void shanghaoCore.recording
                .showClipInFolder(result.filePath)
                .catch(() => setError("文件找不到或已被移动"))
            }
          >
            <FolderSearch />
            在文件夹中显示
          </Button>
        </div>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="recording-clip-consent-title"
        aria-describedby="recording-clip-consent-description"
        className="modal-surface recording-clip-consent"
        onCancel={() => setConsentMarker(undefined)}
      >
        <h3 id="recording-clip-consent-title">导出名场面</h3>
        <p id="recording-clip-consent-description">
          片段包含房间里其他人的声音，发出去之前请确认朋友同意
        </p>
        <label>
          <input
            type="checkbox"
            checked={doNotAsk}
            onChange={(e) => setDoNotAsk(e.target.checked)}
          />
          不再提示
        </label>
        <div>
          <Button variant="secondary" onClick={() => setConsentMarker(undefined)}>
            取消
          </Button>
          <Button
            onClick={() => {
              const markerId = consentMarker;
              void (async () => {
                try {
                  if (doNotAsk) await onChange({ hasDismissedRecordingClipConsent: true });
                } catch {
                  setError("设置未能保存，请重试");
                  return;
                }
                setConsentMarker(undefined);
                if (markerId) void exportMarker(markerId);
              })();
            }}
          >
            确认导出
          </Button>
        </div>
      </dialog>
    </section>
  );
};
