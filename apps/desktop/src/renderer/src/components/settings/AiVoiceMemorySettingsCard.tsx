import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Download, Pause, Play, Trash2 } from "lucide-react";

import type {
  AiModelAction,
  AiModelId,
  AiModelStatus,
  AiVoiceMemorySnapshot,
  AppSettings,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

interface AiVoiceMemorySettingsCardProps {
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
    : `${(bytes / 1024 ** 2).toFixed(0)} MB`;

const modelPhaseLabel = (model: AiModelStatus): string => {
  if (model.updateInProgress && model.phase === "error") return "新版下载失败 · 旧版仍可用";
  if (model.updateInProgress && model.phase === "paused") return "新版已暂停 · 旧版仍可用";
  if (model.updateInProgress) return `新版下载中 ${Math.round(model.progress)}% · 旧版仍可用`;
  if (model.phase === "installed") return "已安装";
  if (model.phase === "checking") return "正在检查文件…";
  if (model.phase === "downloading") return `下载中 ${Math.round(model.progress)}%`;
  if (model.phase === "paused") return `已暂停 ${Math.round(model.progress)}%`;
  if (model.phase === "error") return "下载失败";
  return "未安装";
};

const ModelActions = ({
  model,
  busy,
  onAction,
}: {
  model: AiModelStatus;
  busy: boolean;
  onAction: (action: AiModelAction) => void;
}) => {
  if (model.phase === "not_installed" || (model.phase === "error" && !model.activeRevision)) {
    return (
      <Button disabled={busy} onClick={() => onAction("download")}>
        <Download className="size-4" aria-hidden="true" /> 下载模型
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {model.phase === "error" ? (
        <Button disabled={busy} onClick={() => onAction("download")}>
          <Download className="size-4" aria-hidden="true" /> 重试新版
        </Button>
      ) : null}
      {model.phase === "downloading" || model.phase === "checking" ? (
        <Button variant="secondary" disabled={busy} onClick={() => onAction("pause")}>
          <Pause className="size-4" aria-hidden="true" /> 暂停
        </Button>
      ) : model.phase === "paused" ? (
        <Button variant="secondary" disabled={busy} onClick={() => onAction("resume")}>
          <Play className="size-4" aria-hidden="true" /> 继续
        </Button>
      ) : null}
      <Button variant="ghost" disabled={busy} onClick={() => onAction("delete")}>
        <Trash2 className="size-4" aria-hidden="true" /> 删除
      </Button>
    </div>
  );
};

export const AiVoiceMemorySettingsCard = ({
  settings,
  onChange,
  pushToast,
}: AiVoiceMemorySettingsCardProps) => {
  const [snapshot, setSnapshot] = useState<AiVoiceMemorySnapshot>();
  const [busyModel, setBusyModel] = useState<AiModelId>();
  const [pendingDeleteModel, setPendingDeleteModel] = useState<AiModelStatus>();

  useEffect(() => {
    let active = true;
    const aiApi = window.desktopApi.ai;
    if (!aiApi || typeof aiApi.getSnapshot !== "function" || typeof aiApi.onStatus !== "function") {
      pushToast({
        tone: "neutral",
        title: "需要重新打开上号",
        description: "模型管理刚完成更新，完全退出后重新打开即可使用。",
      });
      return;
    }
    void aiApi
      .getSnapshot()
      .then((next) => active && setSnapshot(next))
      .catch(() =>
        pushToast({
          tone: "danger",
          title: "模型状态读取失败",
          description: "请完全退出并重新打开上号。",
        }),
      );
    const unsubscribe = aiApi.onStatus((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [pushToast]);

  const controlModel = async (model: AiModelStatus, action: AiModelAction) => {
    if (action === "delete") {
      setPendingDeleteModel(model);
      return;
    }
    await runModelAction(model, action);
  };

  const runModelAction = async (model: AiModelStatus, action: AiModelAction) => {
    setBusyModel(model.id);
    try {
      const next = await window.desktopApi.ai.controlModel(model.id, action);
      setSnapshot(next);
      pushToast({
        tone: "success",
        title:
          action === "delete"
            ? `${model.name} 已删除`
            : action === "pause"
              ? "下载已暂停"
              : "模型会在后台下载",
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "操作失败",
        description: error instanceof Error ? error.message : "请检查网络后重试。",
      });
    } finally {
      setBusyModel(undefined);
    }
  };

  const vibeInstalled = Boolean(
    snapshot?.models.find((model) => model.id === "vibevoice")?.activeRevision,
  );
  const qwenInstalled = Boolean(
    snapshot?.models.find((model) => model.id === "qwen35-4b")?.activeRevision,
  );

  return (
    <SettingsSection
      title="AI 语音记忆"
      description="模型保存在本机。首次使用由你手动下载，安装包不会自动附带。"
    >
      <div className="ai-voice-memory-models">
        {(snapshot?.models ?? []).map((model) => (
          <article className="ai-model-card" key={model.id}>
            <div className="ai-model-copy">
              <div className="ai-model-title-row">
                <span className="ai-model-icon" aria-hidden="true">
                  <BrainCircuit />
                </span>
                <div>
                  <h3 className="text-balance">{model.name}</h3>
                  <p className="text-pretty">
                    {model.purpose} · 约 {formatBytes(model.approximateBytes)}
                  </p>
                </div>
                <strong className={`ai-model-phase is-${model.phase}`}>
                  {modelPhaseLabel(model)}
                </strong>
              </div>
              {model.totalBytes > 0 ? (
                <div className="ai-model-progress-wrap">
                  <div
                    className="ai-model-progress"
                    role="progressbar"
                    aria-label={`${model.name} 下载进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(model.progress)}
                  >
                    <span style={{ transform: `scaleX(${model.progress / 100})` }} />
                  </div>
                  <small className="tabular-nums">
                    {formatBytes(model.downloadedBytes)} / {formatBytes(model.totalBytes)} ·{" "}
                    {Math.round(model.progress)}%
                    {model.bytesPerSecond
                      ? ` · ${formatBytes(model.bytesPerSecond)}/s${snapshot?.scheduler.gameActive ? "（游戏中已降速）" : ""}`
                      : ""}
                  </small>
                </div>
              ) : null}
              {model.errorMessage ? <p className="ai-model-error">{model.errorMessage}</p> : null}
            </div>
            <ModelActions
              model={model}
              busy={busyModel === model.id}
              onAction={(action) => void controlModel(model, action)}
            />
          </article>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <SettingsItemRow
          label="后台处理方式"
          description={
            snapshot?.scheduler.gameActive
              ? "检测到游戏，下载已降速，AI 任务会让出 CPU、GPU 和显存。"
              : "默认等游戏结束后再处理录音。"
          }
        >
          <select
            className="ai-processing-select"
            aria-label="AI 后台处理方式"
            value={settings.aiProcessingMode}
            onChange={(event) =>
              void onChange({
                aiProcessingMode: event.target.value as AppSettings["aiProcessingMode"],
              })
            }
          >
            <option value="after_game">游戏结束后处理</option>
            <option value="low_resource">后台低资源处理</option>
            <option value="immediate">立即处理</option>
            <option value="manual">仅手动处理</option>
          </select>
        </SettingsItemRow>
        <SettingsItemRow
          label="自动转录"
          description={vibeInstalled ? "新录音保存后自动排队转成文字。" : "需要先下载 VibeVoice。"}
        >
          <Switch
            isChecked={settings.isAiAutoTranscribeEnabled}
            isDisabled={!vibeInstalled}
            ariaLabel="自动转录"
            onChange={(checked) => void onChange({ isAiAutoTranscribeEnabled: checked })}
          />
        </SettingsItemRow>
        <SettingsItemRow
          label="自动整理"
          description={
            qwenInstalled ? "转录完成后生成总结、章节和精彩片段。" : "需要先下载 Qwen3.5-4B。"
          }
        >
          <Switch
            isChecked={settings.isAiAutoOrganizeEnabled}
            isDisabled={!qwenInstalled || !vibeInstalled}
            ariaLabel="自动整理"
            onChange={(checked) => void onChange({ isAiAutoOrganizeEnabled: checked })}
          />
        </SettingsItemRow>
      </div>
      {pendingDeleteModel
        ? createPortal(
            <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-6">
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-ai-model-title"
                aria-describedby="delete-ai-model-description"
                className="modal-surface w-full max-w-[430px] rounded-[26px] p-6"
              >
                <h2
                  id="delete-ai-model-title"
                  className="text-balance text-[22px] font-bold text-[#172235]"
                >
                  删除 {pendingDeleteModel.name}？
                </h2>
                <p
                  id="delete-ai-model-description"
                  className="mt-2 text-pretty text-sm leading-6 text-[#66778d]"
                >
                  删除后，对应的本地 AI 功能会停用；录音和已有结果不会被删除。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={busyModel === pendingDeleteModel.id}
                    onClick={() => setPendingDeleteModel(undefined)}
                  >
                    取消
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busyModel === pendingDeleteModel.id}
                    onClick={() => {
                      const model = pendingDeleteModel;
                      setPendingDeleteModel(undefined);
                      void runModelAction(model, "delete");
                    }}
                  >
                    确认删除
                  </Button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </SettingsSection>
  );
};
