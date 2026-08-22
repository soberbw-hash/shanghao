import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Download, Pause, Play, Trash2 } from "lucide-react";

import type {
  AiAsrModelId,
  AiModelAction,
  AiModelId,
  AiModelStatus,
  AiRuntimeStatus,
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

const runtimePhaseLabel = (status?: AiRuntimeStatus["asr"]): string => {
  if (!status) return "正在读取";
  if (status.ready) return status.runtimePhase === "running" ? "正在处理" : "可以使用";
  if (status.runtimePhase === "missing") return "模型未安装";
  if (status.runtimePhase === "error") return "运行异常";
  if (status.runtimePhase === "stopped") return "等待任务";
  return "正在启动";
};

const runtimeSummary = (status?: AiRuntimeStatus["asr"]): string => {
  if (!status) return "正在读取本机 AI 状态…";
  if (status.ready) {
    return status.runtimePhase === "running"
      ? "语音转文字模型正在处理录音。"
      : "语音转文字模型已准备好，可以正常使用。";
  }
  if (status.runtimePhase === "missing") return "当前选择的语音转文字模型还没有安装。";
  if (status.runtimePhase === "error") return "语音转文字模型没有正常启动，请尝试修复组件。";
  return "正在准备语音转文字模型，请稍等。";
};

const taskProgressLabel = (task: NonNullable<AiRuntimeStatus["lastTask"]>): string => {
  if (task.status === "pending") return "等待处理";
  if (task.status === "success") return "处理完成";
  if (task.status === "failed") return "处理失败";
  const stages: Record<typeof task.stage, string> = {
    recording: "正在等待录音保存",
    audio_file: "正在读取录音文件",
    preprocess: "正在检查录音内容",
    convert: "正在转换录音格式",
    asr: "正在识别语音",
    transcript: "正在生成转录文字",
    storage: "正在保存转录结果",
    organize: "正在生成总结和章节",
  };
  return stages[task.stage];
};

const taskErrorLabel = (message: string): string => {
  if (message.includes("no_reliable_speech")) return "没有检测到清晰、可靠的中文语音。";
  if (message.includes("not_installed") || message.includes("model_not_found")) {
    return "需要的本地模型还没有安装。";
  }
  if (message.includes("ffmpeg") || message.includes("convert")) {
    return "录音格式转换没有完成。";
  }
  if (message.includes("timeout")) return "本次处理时间过长，已经停止。";
  if (message.includes("memory") || message.includes("allocation")) {
    return "电脑当前可用内存不足，处理没有完成。";
  }
  return "这次处理没有完成，请稍后重试。";
};

const ModelActions = ({
  model,
  busy,
  selected,
  onSelect,
  onAction,
}: {
  model: AiModelStatus;
  busy: boolean;
  selected: boolean;
  onSelect?: () => void;
  onAction: (action: AiModelAction) => void;
}) => {
  if (model.phase === "not_installed" || (model.phase === "error" && !model.activeRevision)) {
    return (
      <Button disabled={busy} onClick={() => onAction("download")}>
        <Download className="size-4" aria-hidden="true" /> 下载模型
      </Button>
    );
  }
  if (model.phase === "installed") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {model.category === "asr" || model.id !== "qwen35-4b" ? (
          selected ? (
            <span className="ai-model-selected" aria-current="true">
              当前使用
            </span>
          ) : model.runtimeReady ? (
            <Button disabled={busy} onClick={onSelect}>
              使用
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => onAction("download")}>
              修复组件
            </Button>
          )
        ) : null}
        <Button variant="ghost" disabled={busy} onClick={() => onAction("delete")}>
          <Trash2 className="size-4" aria-hidden="true" /> 删除
        </Button>
      </div>
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
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus>();

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

  useEffect(() => {
    let active = true;
    const aiApi = window.desktopApi.ai;
    if (!aiApi || typeof aiApi.getRuntimeStatus !== "function") return;

    const refresh = () => {
      void aiApi
        .getRuntimeStatus()
        .then((next) => active && setRuntimeStatus(next))
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

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
      if (action === "delete" && model.id === settings.aiAsrModel) {
        await onChange({
          isAiAutoTranscribeEnabled: false,
          isAiAutoOrganizeEnabled: false,
        });
      }
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

  const selectAsrModel = async (model: AiModelStatus) => {
    if (model.id === "qwen35-4b" || !model.activeRevision || !model.runtimeReady) return;
    setBusyModel(model.id);
    try {
      await onChange({ aiAsrModel: model.id as AiAsrModelId });
      pushToast({
        tone: "success",
        title: `已切换到 ${model.name}`,
        description: "新录音和重新转录会使用这套模型，已有文字不会改变。",
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "切换失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    } finally {
      setBusyModel(undefined);
    }
  };

  const models = snapshot?.models ?? [];
  const asrModels = models.filter((model) => model.category === "asr" || model.id !== "qwen35-4b");
  const organizerModel = models.find((model) => model.id === "qwen35-4b");
  const selectedAsr = asrModels.find((model) => model.id === settings.aiAsrModel);
  // A renderer hot update can briefly run against the previous Electron main/preload process.
  // Older runtime snapshots expose only `vibevoice`; keep the settings page usable until restart.
  const asrRuntimeStatus = runtimeStatus?.asr ?? runtimeStatus?.vibevoice;
  const selectedAsrReady = Boolean(
    selectedAsr?.activeRevision && (selectedAsr.runtimeReady ?? asrRuntimeStatus?.ready),
  );
  const qwenInstalled = Boolean(organizerModel?.activeRevision);

  const renderModel = (model: AiModelStatus) => (
    <article
      className={`ai-model-card${model.id === settings.aiAsrModel ? " is-selected" : ""}`}
      key={model.id}
    >
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
          <strong className={`ai-model-phase is-${model.phase}`}>{modelPhaseLabel(model)}</strong>
        </div>
        {model.totalBytes > 0 && model.phase !== "installed" ? (
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
        {model.activeRevision && !model.runtimeReady && model.runtimeMessage ? (
          <p className="ai-model-error">{model.runtimeMessage}</p>
        ) : null}
      </div>
      <ModelActions
        model={model}
        busy={busyModel === model.id}
        selected={model.id === settings.aiAsrModel}
        onSelect={() => void selectAsrModel(model)}
        onAction={(action) => void controlModel(model, action)}
      />
    </article>
  );

  return (
    <SettingsSection
      title="AI 语音记忆"
      description="模型保存在本机。首次使用由你手动下载，安装包不会自动附带。"
    >
      <section className="ai-model-group" aria-labelledby="asr-models-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="asr-models-title">转录模型</h3>
            <p>三选一。切换只影响新录音和重新转录。</p>
          </div>
          <span>{selectedAsr?.name ?? "未选择"}</span>
        </div>
        <div className="ai-model-list">{asrModels.map(renderModel)}</div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="organizer-model-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="organizer-model-title">整理模型</h3>
            <p>负责总结、章节、问答和精彩片段，不参与语音识别。</p>
          </div>
        </div>
        <div className="ai-model-list">{organizerModel ? renderModel(organizerModel) : null}</div>
      </section>

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
          description={
            selectedAsrReady
              ? `新录音保存后由 ${selectedAsr?.name ?? "当前模型"} 自动转成文字。`
              : "需要先下载并启用一套转录模型。"
          }
        >
          <Switch
            isChecked={settings.isAiAutoTranscribeEnabled}
            isDisabled={!selectedAsrReady}
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
            isDisabled={!qwenInstalled || !selectedAsrReady}
            ariaLabel="自动整理"
            onChange={(checked) => void onChange({ isAiAutoOrganizeEnabled: checked })}
          />
        </SettingsItemRow>
      </div>
      {import.meta.env.DEV ? (
        <section
          className="mt-5 rounded-[18px] border border-[#dbe8f7]/80 bg-white/55 p-4 text-sm"
          aria-labelledby="ai-processing-status-title"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <strong id="ai-processing-status-title" className="text-balance text-[#26364d]">
                AI 处理状态
              </strong>
              <p className="mt-1 text-pretty text-xs leading-5 text-[#718096]">
                查看语音转文字是否正常，以及最近一条录音处理到了哪一步。
              </p>
            </div>
            {asrRuntimeStatus?.ready ? (
              <span className="shrink-0 text-xs font-semibold text-[#24845a]" aria-live="polite">
                {runtimePhaseLabel(asrRuntimeStatus)}
              </span>
            ) : asrRuntimeStatus?.runtimePhase === "missing" ||
              asrRuntimeStatus?.runtimePhase === "error" ? (
              <span className="shrink-0 text-xs font-semibold text-[#bd5c5c]" aria-live="polite">
                {runtimePhaseLabel(asrRuntimeStatus)}
              </span>
            ) : (
              <span className="shrink-0 text-xs font-semibold text-[#718096]" aria-live="polite">
                {runtimePhaseLabel(asrRuntimeStatus)}
              </span>
            )}
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs leading-5 text-[#718096] md:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-semibold text-[#52657d]">语音转文字</dt>
              <dd className="truncate" title={asrRuntimeStatus?.modelName}>
                {asrRuntimeStatus?.modelName ?? "正在读取模型信息…"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-semibold text-[#52657d]">运行情况</dt>
              <dd className="text-pretty">{runtimeSummary(asrRuntimeStatus)}</dd>
            </div>
            {runtimeStatus?.lastTask ? (
              <>
                <div className="min-w-0">
                  <dt className="font-semibold text-[#52657d]">最近处理的录音</dt>
                  <dd className="truncate" title={runtimeStatus.lastTask.fileName}>
                    {runtimeStatus.lastTask.fileName}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="font-semibold text-[#52657d]">处理进度</dt>
                  <dd>{taskProgressLabel(runtimeStatus.lastTask)}</dd>
                </div>
                {runtimeStatus.lastTask.errorMessage ? (
                  <div className="min-w-0 md:col-span-2">
                    <dt className="font-semibold text-[#a34c4c]">没有完成的原因</dt>
                    <dd className="text-pretty text-[#a34c4c]">
                      {taskErrorLabel(runtimeStatus.lastTask.errorMessage)}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="min-w-0 md:col-span-2">
                <dt className="font-semibold text-[#52657d]">最近处理的录音</dt>
                <dd>还没有开始过转录。</dd>
              </div>
            )}
          </dl>
          <details className="mt-3 border-t border-[#dbe8f7]/80 pt-3 text-xs text-[#718096]">
            <summary className="cursor-pointer select-none font-semibold text-[#52657d]">
              技术信息（排错时使用）
            </summary>
            <dl className="mt-2 grid gap-1 leading-5">
              <div>
                <dt className="inline font-semibold">模型版本：</dt>
                <dd className="inline break-all">{asrRuntimeStatus?.modelVersion ?? "未加载"}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">模型位置：</dt>
                <dd className="inline break-all">{asrRuntimeStatus?.modelPath ?? "未加载"}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">识别格式：</dt>
                <dd className="inline">{asrRuntimeStatus?.asrInputFormat ?? "未确认"}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">内部状态：</dt>
                <dd className="inline break-all">{asrRuntimeStatus?.message ?? "暂无"}</dd>
              </div>
              {runtimeStatus?.lastTask ? (
                <>
                  <div>
                    <dt className="inline font-semibold">任务编号：</dt>
                    <dd className="inline break-all">{runtimeStatus.lastTask.taskId}</dd>
                  </div>
                  <div>
                    <dt className="inline font-semibold">内部阶段：</dt>
                    <dd className="inline">{runtimeStatus.lastTask.stage}</dd>
                  </div>
                  {runtimeStatus.lastTask.errorMessage ? (
                    <div>
                      <dt className="inline font-semibold">原始错误：</dt>
                      <dd className="inline break-all">{runtimeStatus.lastTask.errorMessage}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
            </dl>
          </details>
        </section>
      ) : null}
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
