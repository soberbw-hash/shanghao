import { useState } from "react";
import {
  AI_ASR_MODEL_NAMES,
  DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID,
  type AppSettings,
  type AiAsrModelId,
  type AiModelStatus,
} from "@private-voice/shared";
import { Switch } from "../base/Switch";
import { asrModelLabel } from "../../features/ai/asrModelLabel";

export function CloudLocalAssistControl({
  settings,
  models,
  disabled,
  onChange,
  compact = true,
}: {
  settings?: AppSettings | null;
  models: AiModelStatus[];
  disabled?: boolean;
  onChange: (patch: Partial<AppSettings>) => void;
  compact?: boolean;
}) {
  const [preparing, setPreparing] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const selected = settings?.aiCloudLocalAsrModel ?? DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID;
  const model = models.find((candidate) => candidate.id === selected);
  const ready = Boolean(model?.activeRevision && model.runtimeReady);
  const downloading =
    model && ["queued", "downloading", "checking", "verifying", "preparing"].includes(model.phase);
  if (settings?.aiTranscriptionProvider === "local") return null;
  const enabled = settings?.isAiCloudLocalAssistEnabled ?? true;
  const download = async () => {
    setPreparing(true);
    setDownloadFailed(false);
    try {
      const dependenciesPresent =
        model?.dependencies?.every((id) =>
          models.some((item) => item.id === id && item.activeRevision),
        ) ?? true;
      await window.desktopApi.ai.controlModel(
        selected,
        model?.phase === "paused"
          ? "resume"
          : model?.activeRevision && dependenciesPresent
            ? "repair"
            : "download",
      );
    } catch {
      setDownloadFailed(true);
    } finally {
      setPreparing(false);
    }
  };
  return (
    <div className="cloud-local-assist flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#526b87]">
      <span className="cloud-local-assist-label">本地校对</span>
      <Switch
        isChecked={enabled}
        isDisabled={disabled}
        ariaLabel="云端加本地辅助"
        onChange={(checked) => onChange({ isAiCloudLocalAssistEnabled: checked })}
      />
      {enabled ? (
        <>
          <label className="inline-flex min-w-0 items-center gap-1.5">
            <select
              aria-label="本地辅助模型"
              title={AI_ASR_MODEL_NAMES[selected]}
              value={selected}
              disabled={disabled || preparing}
              className="min-h-[34px] w-[300px] min-w-0 max-w-full rounded-[10px] border border-[#c7daf1] bg-white/70 px-[10px] py-[5px] text-[11px] disabled:opacity-60"
              onChange={(event) => {
                setDownloadFailed(false);
                onChange({ aiCloudLocalAsrModel: event.target.value as AiAsrModelId });
              }}
            >
              {(Object.entries(AI_ASR_MODEL_NAMES) as Array<[AiAsrModelId, string]>).map(
                ([id, name]) => {
                  const installed = models.some(
                    (item) => item.id === id && item.activeRevision && item.runtimeReady,
                  );
                  return (
                    <option key={id} value={id}>
                      {compact ? asrModelLabel(id, name) : name}
                      {id === DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID ? " · 默认" : ""}
                      {installed ? "" : " · 需准备"}
                    </option>
                  );
                },
              )}
            </select>
          </label>
          {!ready ? <span className="cloud-local-assist-fallback">未就绪，先用云端</span> : null}
          {!ready ? (
            <button
              type="button"
              disabled={disabled || preparing || Boolean(downloading)}
              className="rounded-lg border border-[#c7daf1] px-2 py-1 text-[#3978bd] disabled:opacity-50"
              aria-label="下载辅助模型"
              onClick={() => void download()}
            >
              {preparing || downloading
                ? `准备中 ${Math.round(model?.progress ?? 0)}%`
                : model?.activeRevision
                  ? "准备辅助模型"
                  : "下载辅助模型"}
            </button>
          ) : null}
          {downloadFailed ? <span role="alert">准备失败，可重试；云端仍可使用。</span> : null}
        </>
      ) : null}
    </div>
  );
}
