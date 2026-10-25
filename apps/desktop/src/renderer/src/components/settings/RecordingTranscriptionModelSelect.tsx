import { useEffect, useState } from "react";
import {
  AI_ASR_MODEL_NAMES,
  DEFAULT_AI_ASR_MODEL_ID,
  type AiAsrModelId,
  type AiModelStatus,
} from "@private-voice/shared";
import { useSettingsStore } from "../../store/settingsStore";
import { CloudLocalAssistControl } from "./CloudLocalAssistControl";
import { asrModelLabel } from "../../features/ai/asrModelLabel";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

/** Both settings pages commit the same provider and local-model preferences. */
export function RecordingTranscriptionModelSelect({
  disabled,
  onError,
}: {
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const [models, setModels] = useState<AiModelStatus[]>([]);
  const [saving, setSaving] = useState(false);
  const [modelInUse, setModelInUse] = useState(true);
  useEffect(() => {
    let active = true;
    let observedStatus = false;
    void window.desktopApi.ai
      .getSnapshot()
      .then((snapshot) => {
        if (active && !observedStatus) {
          setModels(snapshot.models);
          setModelInUse(Boolean(snapshot.modelConfigurationBusy));
        }
      })
      .catch(() => {});
    const stop = window.desktopApi.ai.onStatus((snapshot) => {
      observedStatus = true;
      if (active) {
        setModels(snapshot.models);
        setModelInUse(Boolean(snapshot.modelConfigurationBusy));
      }
    });
    return () => {
      active = false;
      stop();
    };
  }, []);
  const provider = settings?.aiTranscriptionProvider ?? "cloud";
  const selected =
    provider === "local" ? `local:${settings?.aiAsrModel ?? DEFAULT_AI_ASR_MODEL_ID}` : provider;
  const modeLabel =
    provider === "local" ? "本地转录" : provider === "custom" ? "自定义转录" : "云端转录";
  const choose = async (value: string) => {
    if (disabled || saving || modelInUse) return;
    setSaving(true);
    try {
      await saveSettings(
        value.startsWith("local:")
          ? { aiTranscriptionProvider: "local", aiAsrModel: value.slice(6) as AiAsrModelId }
          : { aiTranscriptionProvider: value === "custom" ? "custom" : "cloud" },
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "模型切换失败，请重试。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="recording-processing-settings">
      <summary>
        <SlidersHorizontal aria-hidden="true" />
        <span>转录设置</span>
        <small>
          {modeLabel}
          {provider !== "local" && (settings?.isAiCloudLocalAssistEnabled ?? true)
            ? " + 本地辅助"
            : ""}
        </small>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="recording-model-controls">
        <p className="recording-summary-provider">摘要由云端生成；本地辅助仅用于转录与校对。</p>
        <label className="recording-transcription-model inline-flex min-w-0 items-center gap-1.5 text-[11px] text-[#526b87]">
          <span>识别方式</span>
          <select
            className="min-h-[34px] w-[220px] max-w-full rounded-[10px] border border-[#c7daf1] bg-white/70 px-[10px] py-[5px] text-inherit disabled:opacity-60"
            aria-label="录音库转录模型"
            value={selected}
            disabled={disabled || saving || modelInUse}
            title={modelInUse ? "AI 任务进行中，结束后可切换模型" : undefined}
            onChange={(event) => void choose(event.target.value)}
          >
            <option value="cloud">SenseVoiceSmall 云端</option>
            <option value="custom">自定义 API</option>
            <optgroup label="本地模型">
              {(Object.entries(AI_ASR_MODEL_NAMES) as Array<[AiAsrModelId, string]>).map(
                ([id, name]) => {
                  const model = models.find((candidate) => candidate.id === id);
                  const ready = Boolean(model?.activeRevision && model.runtimeReady);
                  return (
                    <option key={id} value={`local:${id}`} disabled={!ready}>
                      {asrModelLabel(id, name)}
                      {ready ? "" : "（请先在 AI 功能中准备）"}
                    </option>
                  );
                },
              )}
            </optgroup>
          </select>
        </label>
        <CloudLocalAssistControl
          compact
          settings={settings}
          models={models}
          disabled={disabled || saving || modelInUse}
          onChange={(patch) => void saveSettings(patch).catch((error) => onError(String(error)))}
        />
      </div>
    </details>
  );
}
