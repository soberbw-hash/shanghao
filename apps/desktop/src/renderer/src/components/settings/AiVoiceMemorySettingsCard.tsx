import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Download, Pause, Play, Trash2 } from "lucide-react";

import type {
  AiAsrModelId,
  AiModelAction,
  AiModelId,
  AiModelStatus,
  AiRuntimeStatus,
  AiCustomProviderStatus,
  AiTextProvider,
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
  if (model.phase === "installed") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {model.category !== "support" && !model.runtimeReady ? (
          <Button disabled={busy} onClick={() => onAction("download")}>
            修复组件
          </Button>
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
  const [customProvider, setCustomProvider] = useState<AiCustomProviderStatus>();
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [savingCustomProvider, setSavingCustomProvider] = useState(false);
  const modelManagementRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    let active = true;
    void window.desktopApi.ai
      .getCustomProvider()
      .then((status) => {
        if (!active) return;
        setCustomProvider(status);
        setCustomBaseUrl(status.baseUrl ?? "https://api.deepseek.com");
        setCustomModel(status.model ?? "deepseek-v4-flash");
      })
      .catch(() => undefined);
    return () => {
      active = false;
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

  const saveCustomProvider = async () => {
    setSavingCustomProvider(true);
    try {
      const status = await window.desktopApi.ai.saveCustomProvider({
        baseUrl: customBaseUrl,
        model: customModel,
        apiKey: customApiKey || undefined,
      });
      setCustomProvider(status);
      setCustomApiKey("");
      pushToast({ tone: "success", title: "自定义 API 已安全保存" });
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "自定义 API 保存失败",
        description: error instanceof Error ? error.message : "请检查地址、模型和密钥。",
      });
    } finally {
      setSavingCustomProvider(false);
    }
  };

  const models = snapshot?.models ?? [];
  const asrModels = models.filter((model) => model.category === "asr");
  const supportModels = models.filter((model) => model.category === "support");
  const organizerModel = models.find((model) => model.id === "qwen35-4b");
  const selectedAsr = asrModels.find((model) => model.id === settings.aiAsrModel);
  const asrRuntimeStatus = runtimeStatus?.asr;
  const selectedAsrReady = Boolean(
    selectedAsr?.activeRevision && (selectedAsr.runtimeReady ?? asrRuntimeStatus?.ready),
  );
  const qwenInstalled = Boolean(organizerModel?.activeRevision);
  const organizerReady =
    settings.aiOrganizerProvider === "local"
      ? qwenInstalled
      : settings.aiOrganizerProvider === "custom"
        ? Boolean(customProvider?.configured)
        : true;
  const showCustomProvider =
    settings.aiOrganizerProvider === "custom" || settings.aiRoomAskProvider === "custom";

  const chooseAsrModel = (model: AiModelStatus) => {
    if (!model.activeRevision || !model.runtimeReady) {
      pushToast({
        tone: "neutral",
        title: `需要先下载 ${model.name}`,
        description: "已为你定位到上方的模型管理。安装并校验完成后即可选择。",
      });
      modelManagementRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    void selectAsrModel(model);
  };

  const providerSelect = (
    value: AiTextProvider,
    setting: "aiOrganizerProvider" | "aiRoomAskProvider",
    ariaLabel: string,
  ) => (
    <select
      className="ai-processing-select"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) =>
        void onChange({ [setting]: event.target.value as AiTextProvider } as Partial<AppSettings>)
      }
    >
      <option value="cloud">房间云端（默认）</option>
      <option value="local">本地 Qwen</option>
      <option value="custom">自定义 API</option>
    </select>
  );

  const renderModel = (model: AiModelStatus) => (
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
            {model.dependencies?.includes("qwen3-forced-aligner-0.6b") ? (
              <small className="ai-model-dependency">另需共用时间对齐组件，不会重复下载</small>
            ) : null}
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
        {model.hardwareNote ? <p className="ai-model-note">{model.hardwareNote}</p> : null}
      </div>
      <ModelActions
        model={model}
        busy={busyModel === model.id}
        onAction={(action) => void controlModel(model, action)}
      />
    </article>
  );

  return (
    <SettingsSection title="AI 语音记忆" description="模型下载、转录选择和内容分析已经分开管理。">
      <section
        ref={modelManagementRef}
        id="ai-model-management"
        className="ai-model-group scroll-mt-4"
        aria-labelledby="model-management-title"
      >
        <div className="ai-model-group-heading">
          <div>
            <h3 id="model-management-title">1. 模型管理</h3>
            <p>只管理本机模型的下载、校验、暂停、继续和删除。</p>
          </div>
        </div>
        <div className="ai-model-management-grid">
          {asrModels.map(renderModel)}
          {supportModels.map(renderModel)}
          {organizerModel ? renderModel(organizerModel) : null}
        </div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="transcription-settings-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="transcription-settings-title">2. 转录设置</h3>
            <p>选择新录音和下次重新转录要使用的模型。</p>
          </div>
          <span>{selectedAsr?.name ?? "未选择"}</span>
        </div>
        <div className="ai-asr-choice-grid" role="radiogroup" aria-label="转录模型">
          {asrModels.map((model) => {
            const selected = model.id === settings.aiAsrModel;
            const installed = Boolean(model.activeRevision && model.runtimeReady);
            return (
              <button
                type="button"
                key={model.id}
                className={`ai-asr-choice${selected ? " is-selected" : ""}${installed ? "" : " is-unavailable"}`}
                role="radio"
                aria-checked={selected}
                onClick={() => chooseAsrModel(model)}
              >
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.purpose}</small>
                </span>
                <em>{installed ? (selected ? "当前使用" : "已安装") : "需先下载"}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="ai-analysis-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="ai-analysis-title">3. AI 总结与其他能力</h3>
            <p>管理转录完成后的总结、章节、精彩片段和房间问答。</p>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <SettingsItemRow
            label="整理内容用什么"
            description={
              settings.aiOrganizerProvider === "cloud"
                ? "默认使用房间云端 AI；转录文字会发送到上号服务器进行总结和分段。"
                : settings.aiOrganizerProvider === "local"
                  ? "完全在本机整理，需要先安装 Qwen3.5-4B。"
                  : "使用你保存在这台电脑上的 OpenAI 兼容 API。"
            }
          >
            {providerSelect(settings.aiOrganizerProvider, "aiOrganizerProvider", "整理内容方式")}
          </SettingsItemRow>
          <SettingsItemRow
            label="房间里的“问”用什么"
            description={
              settings.aiRoomAskProvider === "cloud"
                ? "默认使用房间云端 AI，可联网搜索；问题和相关语音片段会发送到上号服务器。"
                : settings.aiRoomAskProvider === "local"
                  ? "只用本机 Qwen 和本地语音记忆，不联网搜索。"
                  : "使用你保存在这台电脑上的 OpenAI 兼容 API。"
            }
          >
            {providerSelect(settings.aiRoomAskProvider, "aiRoomAskProvider", "房间问答方式")}
          </SettingsItemRow>
          {showCustomProvider ? (
            <div className="settings-item-row rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <label className="min-w-0 flex-1 text-sm font-medium text-[#26364d]">
                  API 地址
                  <input
                    className="mt-1 w-full rounded-xl border border-[#d7e4f4] bg-white px-3 py-2 text-sm"
                    value={customBaseUrl}
                    onChange={(event) => setCustomBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <label className="min-w-0 flex-1 text-sm font-medium text-[#26364d]">
                  模型名称
                  <input
                    className="mt-1 w-full rounded-xl border border-[#d7e4f4] bg-white px-3 py-2 text-sm"
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder="模型 ID"
                  />
                </label>
                <label className="min-w-0 flex-1 text-sm font-medium text-[#26364d]">
                  API 密钥
                  <input
                    className="mt-1 w-full rounded-xl border border-[#d7e4f4] bg-white px-3 py-2 text-sm"
                    type="password"
                    autoComplete="off"
                    value={customApiKey}
                    onChange={(event) => setCustomApiKey(event.target.value)}
                    placeholder={customProvider?.hasApiKey ? "已保存；留空不修改" : "请输入密钥"}
                  />
                </label>
                <div className="flex shrink-0 gap-2">
                  <Button disabled={savingCustomProvider} onClick={() => void saveCustomProvider()}>
                    保存
                  </Button>
                  {customProvider?.configured ? (
                    <Button
                      variant="ghost"
                      disabled={savingCustomProvider}
                      onClick={() => {
                        void window.desktopApi.ai.clearCustomProvider().then(() => {
                          setCustomProvider({ configured: false, hasApiKey: false });
                          setCustomApiKey("");
                        });
                      }}
                    >
                      清除
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#718096]">
                密钥由 Windows 加密后只保存在本机，不会写入设置文件、日志或 GitHub。仅允许 HTTPS
                公网地址。
              </p>
            </div>
          ) : null}
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
              organizerReady
                ? "转录完成后生成总结、章节和精彩片段。"
                : settings.aiOrganizerProvider === "local"
                  ? "需要先下载 Qwen3.5-4B。"
                  : "需要先保存自定义 API。"
            }
          >
            <Switch
              isChecked={settings.isAiAutoOrganizeEnabled}
              isDisabled={!organizerReady || !selectedAsrReady}
              ariaLabel="自动整理"
              onChange={(checked) => void onChange({ isAiAutoOrganizeEnabled: checked })}
            />
          </SettingsItemRow>
        </div>
      </section>
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
