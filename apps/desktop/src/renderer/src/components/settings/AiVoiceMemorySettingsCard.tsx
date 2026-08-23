import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Download, ExternalLink, KeyRound, Pause, Play, Trash2 } from "lucide-react";

import type {
  AiAsrModelId,
  AiModelAction,
  AiModelId,
  AiModelStatus,
  AiRuntimeStatus,
  AiCustomProviderStatus,
  AiHuggingFaceAccessStatus,
  AiTextProvider,
  AiVoiceMemorySnapshot,
  AppSettings,
} from "@private-voice/shared";

import { modelPhaseLabel, modelProgressPercent } from "../../features/ai/modelDownloadPresentation";
import { playUiSound } from "../../features/audio/uiSound";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";
import type { ToastMessage } from "../../store/appStore";
import { toUserFacingError } from "../../utils/userFacingError";

interface AiVoiceMemorySettingsCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

const formatBytes = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(0)} MB`;

const MODEL_TAGS: Partial<Record<AiModelId, readonly string[]>> = {
  "qwen3-asr-1.7b-force": ["中文", "精确时间轴", "CUDA"],
  "qwen3-asr-0.6b-force": ["轻量", "精确时间轴", "CUDA"],
  "fun-asr-nano-2512": ["中文", "BF16", "CUDA"],
  "glm-asr-nano-2512": ["复杂环境", "BF16", "CUDA"],
  "fireredasr2-aed": ["中文", "原生时间戳", "FP16"],
  "paraformer-zh": ["中文", "极速", "套件"],
  "moss-transcribe-diarize-0.9b": ["长音频", "多人分离", "原生时间戳", "BF16"],
  "dolphin-cn-dialect-0.4b": ["中文", "方言", "热词", "词级时间戳"],
  "cohere-transcribe-2b": ["多语言", "高准确率", "长音频", "BF16"],
  "qwen3-forced-aligner-0.6b": ["共享组件", "精确对齐"],
  "qwen35-4b": ["本地整理", "总结", "章节"],
};

const COHERE_TERMS_URL = "https://huggingface.co/CohereLabs/cohere-transcribe-03-2026";
const HUGGING_FACE_TOKENS_URL = "https://huggingface.co/settings/tokens";

const ModelActions = ({
  model,
  busy,
  dependencyPending,
  onAction,
}: {
  model: AiModelStatus;
  busy: boolean;
  dependencyPending: boolean;
  onAction: (action: AiModelAction) => void;
}) => {
  const accessManaged = model.id === "cohere-transcribe-2b";
  if (model.phase === "not_installed") {
    if (accessManaged) return null;
    return (
      <Button disabled={busy} onClick={() => onAction("download")}>
        <Download className="size-4" aria-hidden="true" /> 下载模型
      </Button>
    );
  }
  if (model.phase === "installed") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {model.category !== "support" && !model.runtimeReady && !dependencyPending ? (
          <Button disabled={busy} onClick={() => onAction("download")}>
            修复运行组件
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
      {model.phase === "error" && model.failureKind !== "access" ? (
        <Button disabled={busy} onClick={() => onAction("download")}>
          <Download className="size-4" aria-hidden="true" />
          {model.failureKind === "integrity"
            ? "重新校验并修复"
            : model.failureKind === "network"
              ? "检查网络后继续"
              : model.failureKind === "disk"
                ? "清理空间后重试"
                : "继续下载"}
        </Button>
      ) : null}
      {model.phase === "queued" || model.phase === "downloading" || model.phase === "checking" ? (
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
  const [huggingFaceAccess, setHuggingFaceAccess] = useState<AiHuggingFaceAccessStatus>();
  const [huggingFaceToken, setHuggingFaceToken] = useState("");
  const [savingHuggingFaceAccess, setSavingHuggingFaceAccess] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [savingCustomProvider, setSavingCustomProvider] = useState(false);
  const modelManagementRef = useRef<HTMLElement>(null);
  const previousModelPhasesRef = useRef<Map<AiModelId, AiModelStatus["phase"]>>(new Map());

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
    const aiApi = window.desktopApi.ai;
    if (!aiApi || typeof aiApi.getHuggingFaceAccess !== "function") return;
    void aiApi
      .getHuggingFaceAccess()
      .then((status) => active && setHuggingFaceAccess(status))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!pendingDeleteModel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyModel !== pendingDeleteModel.id) {
        setPendingDeleteModel(undefined);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busyModel, pendingDeleteModel]);

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
      if (action === "delete") pushToast({ tone: "success", title: `${model.name} 已删除` });
    } catch (error) {
      pushToast({
        tone: "danger",
        ...toUserFacingError(error, "model"),
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
        description: "录音库已同步；已有该模型结果的录音会自动显示对应文字。",
      });
    } catch (error) {
      pushToast({
        tone: "danger",
        ...toUserFacingError(error, "model"),
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
    } catch {
      pushToast({
        tone: "danger",
        title: "自定义 API 保存失败",
        description: "请检查 API 地址、模型名称和密钥是否填写正确，然后重试。",
      });
    } finally {
      setSavingCustomProvider(false);
    }
  };

  const openHuggingFacePage = (url: string) => {
    void window.desktopApi.app.openExternal(url);
  };

  const handleHuggingFaceAccess = async (model: AiModelStatus) => {
    const token = huggingFaceToken.trim();
    if (!huggingFaceAccess?.configured && !token) {
      pushToast({
        tone: "neutral",
        title: "还差一个只读 Token",
        description: "先完成上面的两步，再把以 hf_ 开头的只读 Token 粘贴到输入框。",
      });
      return;
    }
    setSavingHuggingFaceAccess(true);
    try {
      if (token) {
        const status = await window.desktopApi.ai.saveHuggingFaceAccess({ token });
        setHuggingFaceAccess(status);
        setHuggingFaceToken("");
        pushToast({
          tone: "success",
          title: "Hugging Face 授权已保存",
          description: "Token 已由 Windows 加密保存在本机，现在开始下载模型。",
        });
      }
      await runModelAction(model, model.phase === "paused" ? "resume" : "download");
    } catch {
      pushToast({
        tone: "danger",
        title: "授权信息没有保存",
        description: "请确认使用以 hf_ 开头的只读 Token，并重新粘贴后再试。",
      });
    } finally {
      setSavingHuggingFaceAccess(false);
    }
  };

  const clearHuggingFaceAccess = async () => {
    setSavingHuggingFaceAccess(true);
    try {
      await window.desktopApi.ai.clearHuggingFaceAccess();
      setHuggingFaceAccess({ configured: false });
      setHuggingFaceToken("");
      pushToast({ tone: "success", title: "本机 Hugging Face 授权已清除" });
    } catch {
      pushToast({
        tone: "danger",
        title: "授权信息清除失败",
        description: "请完全退出上号后重试。",
      });
    } finally {
      setSavingHuggingFaceAccess(false);
    }
  };

  const models = snapshot?.models ?? [];

  useEffect(() => {
    if (!snapshot) return;
    const previousPhases = previousModelPhasesRef.current;
    if (previousPhases.size === 0) {
      for (const model of snapshot.models) previousPhases.set(model.id, model.phase);
      return;
    }

    for (const model of snapshot.models) {
      const previousPhase = previousPhases.get(model.id);
      if (previousPhase && previousPhase !== model.phase) {
        if (model.phase === "error") {
          playUiSound("process-error");
        } else if (model.phase === "installed") {
          playUiSound("model-complete");
        } else if (model.phase === "verifying" || model.phase === "preparing") {
          playUiSound("model-checkpoint");
        } else if (model.phase === "queued") {
          playUiSound("model-queued");
        }
      }
      previousPhases.set(model.id, model.phase);
    }
  }, [snapshot]);

  const modelSort = (left: AiModelStatus, right: AiModelStatus) => {
    const score = (model: AiModelStatus) =>
      model.id === settings.aiAsrModel ? 0 : model.activeRevision ? 1 : 2;
    return score(left) - score(right);
  };
  const asrModels = models.filter((model) => model.category === "asr").sort(modelSort);
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
  const showCustomProvider = settings.aiOrganizerProvider === "custom";
  const installedAsrCount = asrModels.filter((model) => model.activeRevision).length;
  const installedOrganizerCount = organizerModel?.activeRevision ? 1 : 0;

  const chooseAsrModel = (model: AiModelStatus) => {
    if (model.id === settings.aiAsrModel) return;
    if (!model.activeRevision) {
      pushToast({
        tone: "neutral",
        title: `${model.name} 尚未安装`,
        description: "点击卡片右侧的“下载模型”，安装并校验完成后即可直接切换。",
      });
      return;
    }
    if (!model.runtimeReady) {
      const dependencyPending = Boolean(
        model.dependencies?.some((dependencyId) => {
          const dependency = models.find((candidate) => candidate.id === dependencyId);
          return !dependency || dependency.phase !== "installed" || !dependency.runtimeReady;
        }),
      );
      pushToast({
        tone: "neutral",
        title: `${model.name} 的运行组件尚未就绪`,
        description: dependencyPending
          ? "请先在 B2 安装共用时间对齐组件，完成后即可切换。"
          : "点击卡片右侧的“修复运行组件”，准备完成后即可切换。",
      });
      return;
    }
    void selectAsrModel(model);
  };

  const providerSelect = (
    value: AiTextProvider,
    setting: "aiOrganizerProvider",
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

  const renderModel = (model: AiModelStatus) => {
    const requiresHuggingFaceAccess = model.id === "cohere-transcribe-2b";
    const selectable = model.category === "asr";
    const selected = model.id === settings.aiAsrModel;
    const dependencyPending = Boolean(
      model.dependencies?.some((dependencyId) => {
        const dependency = models.find((candidate) => candidate.id === dependencyId);
        return !dependency || dependency.phase !== "installed" || !dependency.runtimeReady;
      }),
    );
    return (
      <article
        className={`ai-model-card is-${model.category}${selectable ? " is-selectable" : ""}${selected ? " is-selected" : ""}`}
        data-model-id={model.id}
        data-model-phase={model.phase}
        aria-busy={
          model.phase === "queued" ||
          model.phase === "downloading" ||
          model.phase === "checking" ||
          model.phase === "verifying" ||
          model.phase === "preparing"
        }
        key={model.id}
      >
        {selectable ? (
          <button
            type="button"
            className="ai-model-select-hit"
            aria-label={selected ? `${model.name}，当前使用` : `切换为 ${model.name}`}
            aria-pressed={selected}
            disabled={busyModel === model.id || selected}
            onClick={() => chooseAsrModel(model)}
          />
        ) : null}
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
              <div className="ai-model-tags" aria-label="模型特点">
                {(MODEL_TAGS[model.id] ?? []).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              {model.dependencies?.includes("qwen3-forced-aligner-0.6b") ? (
                <small className="ai-model-dependency">另需共用时间对齐组件，不会重复下载</small>
              ) : null}
              {model.optionalDependencies?.includes("qwen3-forced-aligner-0.6b") ? (
                <small className="ai-model-dependency">
                  已安装 ForcedAligner 时自动精确对齐；没有也可转录
                </small>
              ) : null}
            </div>
            <strong className={`ai-model-phase is-${selected ? "selected" : model.phase}`}>
              {selected ? "当前使用" : modelPhaseLabel(model)}
            </strong>
          </div>
          {model.totalBytes > 0 && model.phase !== "installed" ? (
            <div className="ai-model-progress-wrap">
              <div
                className="ai-model-progress"
                role="progressbar"
                aria-label={`${model.name} 下载进度`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={modelProgressPercent(model)}
              >
                <span style={{ transform: `scaleX(${modelProgressPercent(model) / 100})` }} />
              </div>
              <small className="tabular-nums">
                {formatBytes(model.downloadedBytes)} / {formatBytes(model.totalBytes)} ·{" "}
                {modelProgressPercent(model)}%
                {model.phase === "verifying"
                  ? " · 下载完成，正在校验文件完整性"
                  : model.phase === "preparing"
                    ? " · 文件已校验，正在准备运行组件"
                    : ""}
                {model.phase === "downloading" && model.bytesPerSecond
                  ? ` · ${formatBytes(model.bytesPerSecond)}/s${snapshot?.scheduler.gameActive ? "（游戏中已降速）" : ""}`
                  : ""}
              </small>
            </div>
          ) : null}
          {model.errorMessage ? (
            <p className="ai-model-error">
              {model.failureKind === "access"
                ? model.errorMessage
                : model.failureKind === "integrity"
                  ? "模型文件校验未通过，点击“重新校验并修复”；完整文件不会重复下载。"
                  : model.failureKind === "network"
                    ? "模型下载连接已中断。请检查网络或代理后继续，已经下载的部分会保留。"
                    : model.failureKind === "disk"
                      ? "磁盘空间不足。请先清理模型所在磁盘，再点击“清理空间后重试”。"
                      : "模型下载没有完成。请点击“继续下载”，已经下载的部分会保留。"}
            </p>
          ) : null}
          {model.activeRevision && !model.runtimeReady && model.runtimeMessage ? (
            <p className={dependencyPending ? "ai-model-note" : "ai-model-error"}>
              {dependencyPending
                ? "正在等待共用时间对齐组件完成，完成后会自动刷新，无需修复。"
                : "模型已经下载完成，但运行组件还没准备好；点击“修复运行组件”，详细原因可在诊断页查看。"}
            </p>
          ) : null}
          {model.hardwareNote ? <p className="ai-model-note">{model.hardwareNote}</p> : null}
          {requiresHuggingFaceAccess && model.phase !== "installed" ? (
            <div className="ai-model-access-panel" aria-label="Cohere 模型下载授权">
              <div className="ai-model-access-heading">
                <KeyRound aria-hidden="true" />
                <div>
                  <strong>下载前完成一次官方授权</strong>
                  <span>
                    {huggingFaceAccess?.configured
                      ? "本机已保存授权，可直接继续下载"
                      : "这是 Hugging Face 官方门控模型，匿名下载会被拒绝"}
                  </span>
                </div>
              </div>
              <div className="ai-model-access-steps">
                <Button variant="secondary" onClick={() => openHuggingFacePage(COHERE_TERMS_URL)}>
                  1. 接受模型条款 <ExternalLink aria-hidden="true" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => openHuggingFacePage(HUGGING_FACE_TOKENS_URL)}
                >
                  2. 创建只读 Token <ExternalLink aria-hidden="true" />
                </Button>
              </div>
              <div className="ai-model-access-form">
                <input
                  type="password"
                  value={huggingFaceToken}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Hugging Face 只读 Token"
                  placeholder={
                    huggingFaceAccess?.configured
                      ? "已安全保存；如需更换可粘贴新 Token"
                      : "粘贴以 hf_ 开头的只读 Token"
                  }
                  onChange={(event) => setHuggingFaceToken(event.target.value)}
                />
                <Button
                  disabled={savingHuggingFaceAccess || busyModel === model.id}
                  onClick={() => void handleHuggingFaceAccess(model)}
                >
                  <Download aria-hidden="true" />
                  {huggingFaceToken.trim()
                    ? "加密保存并下载"
                    : huggingFaceAccess?.configured
                      ? "使用已保存授权下载"
                      : "保存并下载"}
                </Button>
                {huggingFaceAccess?.configured ? (
                  <Button
                    variant="ghost"
                    disabled={savingHuggingFaceAccess}
                    onClick={() => void clearHuggingFaceAccess()}
                  >
                    清除授权
                  </Button>
                ) : null}
              </div>
              <small>
                Token 只由 Windows 加密保存在这台电脑，仅发送给
                huggingface.co；不会显示在界面、日志或上传到上号服务器。
              </small>
            </div>
          ) : null}
        </div>
        <div className="ai-model-actions">
          <ModelActions
            model={model}
            busy={busyModel === model.id}
            dependencyPending={dependencyPending}
            onAction={(action) => void controlModel(model, action)}
          />
        </div>
      </article>
    );
  };

  return (
    <SettingsSection title="AI 功能" description="先看当前使用状态，再管理转录、整理和房间问答。">
      <section className="ai-overview" aria-labelledby="ai-overview-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="ai-overview-title">A. 概览</h3>
            <p>常用设置和本机安装情况一眼就能确认。</p>
          </div>
        </div>
        <div className="ai-overview-grid">
          <article>
            <small>默认转录模型</small>
            <strong>{selectedAsr?.name ?? "未选择"}</strong>
            <span>{selectedAsrReady ? "可直接转录" : "需要先完成安装"}</span>
          </article>
          <article>
            <small>录音整理模型</small>
            <strong>
              {settings.aiOrganizerProvider === "cloud"
                ? "房间云端 AI"
                : settings.aiOrganizerProvider === "local"
                  ? "本地 Qwen3.5-4B"
                  : "自定义 API"}
            </strong>
            <span>{organizerReady ? "已就绪" : "需要配置"}</span>
          </article>
          <article>
            <small>房间问答模型</small>
            <strong>房间云端 AI</strong>
            <span>无需本地模型</span>
          </article>
          <article>
            <small>本机模型</small>
            <strong>
              {installedAsrCount} 套转录 · {installedOrganizerCount} 套整理
            </strong>
            <span>共享组件单独计入下方</span>
          </article>
        </div>
      </section>

      <section
        ref={modelManagementRef}
        id="ai-model-management"
        className="ai-model-group scroll-mt-4"
        aria-labelledby="model-management-title"
      >
        <div className="ai-model-group-heading">
          <div>
            <h3 id="model-management-title">B. 转录模型与组件</h3>
            <p>主模型、共享组件和整理模型分开管理；已安装的主模型可直接在卡片上切换。</p>
          </div>
        </div>
        <div className="ai-model-subgroup">
          <div className="ai-model-subgroup-heading">
            <strong>B1. 主转录模型</strong>
            <span>点击已安装模型卡即可切换；下载、修复和删除在卡片右侧</span>
          </div>
          <div className="ai-model-management-grid">{asrModels.map(renderModel)}</div>
        </div>
        <div className="ai-model-subgroup is-compact">
          <div className="ai-model-subgroup-heading">
            <strong>B2. 共享组件</strong>
            <span>只下载一份，由需要精确时间轴的模型复用</span>
          </div>
          <div className="ai-model-management-grid">{supportModels.map(renderModel)}</div>
        </div>
        <div className="ai-model-subgroup">
          <div className="ai-model-subgroup-heading">
            <strong>B3. 整理模型</strong>
            <span>只负责总结、章节和精彩片段，不参与语音识别</span>
          </div>
          <div className="ai-model-management-grid">
            {organizerModel ? renderModel(organizerModel) : null}
          </div>
        </div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="transcription-settings-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="transcription-settings-title">C. 转录行为</h3>
            <p>设置新录音何时转录，以及是否自动开始。</p>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <SettingsItemRow
            label="转录时机"
            description={
              snapshot?.scheduler.gameActive
                ? "检测到游戏，下载会降低占用，转录任务按当前设置让出资源。"
                : "选择录音保存后何时开始处理。"
            }
          >
            <select
              className="ai-processing-select"
              aria-label="转录时机"
              value={settings.aiProcessingMode}
              onChange={(event) =>
                void onChange({
                  aiProcessingMode: event.target.value as AppSettings["aiProcessingMode"],
                })
              }
            >
              <option value="after_game">游戏结束后</option>
              <option value="low_resource">后台低资源</option>
              <option value="immediate">立即转录</option>
              <option value="manual">仅手动</option>
            </select>
          </SettingsItemRow>
          <SettingsItemRow
            label="自动转录"
            description={
              selectedAsrReady
                ? `新录音保存后由 ${selectedAsr?.name ?? "当前模型"} 自动转成文字。`
                : "先安装并启用一套转录模型，开关才可使用。"
            }
          >
            <Switch
              isChecked={settings.isAiAutoTranscribeEnabled}
              isDisabled={!selectedAsrReady}
              ariaLabel="自动转录"
              onChange={(checked) => void onChange({ isAiAutoTranscribeEnabled: checked })}
            />
          </SettingsItemRow>
        </div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="ai-analysis-title">
        <div className="ai-model-group-heading">
          <div>
            <h3 id="ai-analysis-title">D. AI 整理与房间问答</h3>
            <p>分别选择录音整理方式，并确认房间里的“问”使用什么。</p>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <SettingsItemRow
            label="录音整理模型"
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
            label="房间问答模型"
            description="固定使用房间云端 AI，可联网搜索；无需安装任何本地问答模型。"
          >
            <span className="ai-cloud-provider-badge">云端 API · 无需本地模型</span>
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
                className="modal-surface relative w-full max-w-[430px] rounded-[26px] p-6"
              >
                <DialogCloseButton
                  className="absolute right-4 top-4"
                  label="取消删除模型"
                  disabled={busyModel === pendingDeleteModel.id}
                  onClick={() => setPendingDeleteModel(undefined)}
                />
                <h2
                  id="delete-ai-model-title"
                  className="pr-12 text-balance text-[22px] font-bold text-[#172235]"
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
