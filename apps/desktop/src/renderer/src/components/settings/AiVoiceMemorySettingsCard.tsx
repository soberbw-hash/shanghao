import { useEffect, useRef, useState, type MouseEvent } from "react";
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
import { useRenderProfiler } from "../../features/diagnostics/renderProfiler";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";
import type { ToastMessage } from "../../store/appStore";
import { toUserFacingError } from "../../utils/userFacingError";

interface AiVoiceMemorySettingsCardProps {
  isActive?: boolean;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
}

let cachedAiVoiceMemorySnapshot: AiVoiceMemorySnapshot | undefined;
let aiVoiceMemorySnapshotRequest: Promise<AiVoiceMemorySnapshot> | undefined;

export const preloadAiVoiceMemorySnapshot = (): Promise<AiVoiceMemorySnapshot> => {
  if (cachedAiVoiceMemorySnapshot) return Promise.resolve(cachedAiVoiceMemorySnapshot);
  if (aiVoiceMemorySnapshotRequest) return aiVoiceMemorySnapshotRequest;
  aiVoiceMemorySnapshotRequest = window.desktopApi.ai
    .getSnapshot()
    .then((snapshot) => {
      cachedAiVoiceMemorySnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      aiVoiceMemorySnapshotRequest = undefined;
    });
  return aiVoiceMemorySnapshotRequest;
};

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
  "moss-transcribe-diarize-0.9b-q8_0": ["多人转录", "说话人区分", "时间戳", "Q8_0"],
  "dolphin-cn-dialect-0.4b": ["中文", "方言", "热词", "词级时间戳"],
  "cohere-transcribe-2b": ["多语言", "高准确率", "长音频", "BF16"],
  "ark-asr-3b-q8_0": ["多语言", "高质量", "Q8_0", "CUDA"],
  "qwen3-forced-aligner-0.6b": ["共享组件", "精确对齐"],
  "qwen35-4b": ["本地整理", "总结", "章节"],
  "qwen36-35b-a3b-nvfp4": ["本地整理", "MoE", "3B Active", "NVFP4"],
};

const COHERE_TERMS_URL = "https://huggingface.co/CohereLabs/cohere-transcribe-03-2026";
const HUGGING_FACE_TOKENS_URL = "https://huggingface.co/settings/tokens";

const localRuntimePhaseLabel = (
  phase: NonNullable<AiModelStatus["runtimeMetrics"]>["phase"],
): string =>
  ({
    missing: "自动准备中",
    stopped: "使用时自动加载",
    starting: "正在准备",
    loading: "正在准备",
    ready: "可以使用",
    running: "正在整理",
    error: "暂时不可用",
  })[phase];

const ModelActions = ({
  model,
  busy,
  dependencyPending,
  onAction,
  onConfigureAccess,
}: {
  model: AiModelStatus;
  busy: boolean;
  dependencyPending: boolean;
  onAction: (action: AiModelAction) => void;
  onConfigureAccess: () => void;
}) => {
  const runAction = (event: MouseEvent<HTMLButtonElement>, action: AiModelAction) => {
    event.stopPropagation();
    onAction(action);
  };
  const accessManaged = model.id === "cohere-transcribe-2b";
  if (model.phase === "not_installed") {
    if (accessManaged) {
      return (
        <Button
          variant="secondary"
          className="h-9 rounded-[11px] px-3 text-xs"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onConfigureAccess();
          }}
        >
          <KeyRound className="size-4" aria-hidden="true" /> 配置下载
        </Button>
      );
    }
    return (
      <Button
        className="h-9 rounded-[11px] px-3 text-xs"
        disabled={busy}
        onClick={(event) => runAction(event, "download")}
      >
        <Download className="size-4" aria-hidden="true" /> 下载模型
      </Button>
    );
  }
  if (model.phase === "installed") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {model.category !== "support" &&
        !model.runtimeReady &&
        !dependencyPending &&
        (model.id !== "qwen36-35b-a3b-nvfp4" || model.runtimeMetrics?.phase === "error") ? (
          <Button
            className="h-9 rounded-[11px] px-3 text-xs"
            disabled={busy}
            onClick={(event) => runAction(event, "repair")}
          >
            重试
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="size-9 rounded-[11px] p-0"
          aria-label={`删除 ${model.name}`}
          title="删除模型"
          disabled={busy}
          onClick={(event) => runAction(event, "delete")}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {model.phase === "error" && model.failureKind !== "access" ? (
        <Button
          className="h-9 rounded-[11px] px-3 text-xs"
          disabled={busy}
          onClick={(event) => runAction(event, "download")}
        >
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
        <Button
          variant="secondary"
          className="h-9 rounded-[11px] px-3 text-xs"
          disabled={busy}
          onClick={(event) => runAction(event, "pause")}
        >
          <Pause className="size-4" aria-hidden="true" /> 暂停
        </Button>
      ) : model.phase === "paused" ? (
        <Button
          variant="secondary"
          className="h-9 rounded-[11px] px-3 text-xs"
          disabled={busy}
          onClick={(event) => runAction(event, "resume")}
        >
          <Play className="size-4" aria-hidden="true" /> 继续
        </Button>
      ) : null}
      <Button
        variant="ghost"
        className="size-9 rounded-[11px] p-0"
        aria-label={`删除 ${model.name}`}
        title="删除模型"
        disabled={busy}
        onClick={(event) => runAction(event, "delete")}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
};

export const AiVoiceMemorySettingsCard = ({
  isActive = true,
  settings,
  onChange,
  pushToast,
}: AiVoiceMemorySettingsCardProps) => {
  const [snapshot, setSnapshot] = useState<AiVoiceMemorySnapshot | undefined>(
    cachedAiVoiceMemorySnapshot,
  );
  const [busyModel, setBusyModel] = useState<AiModelId>();
  const [pendingDeleteModel, setPendingDeleteModel] = useState<AiModelStatus>();
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus>();
  const [customProvider, setCustomProvider] = useState<AiCustomProviderStatus>();
  const [huggingFaceAccess, setHuggingFaceAccess] = useState<AiHuggingFaceAccessStatus>();
  const [huggingFaceToken, setHuggingFaceToken] = useState("");
  const [savingHuggingFaceAccess, setSavingHuggingFaceAccess] = useState(false);
  const [huggingFaceAccessModel, setHuggingFaceAccessModel] = useState<AiModelStatus>();
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [savingCustomProvider, setSavingCustomProvider] = useState(false);
  const modelManagementRef = useRef<HTMLElement>(null);
  const previousModelPhasesRef = useRef<Map<AiModelId, AiModelStatus["phase"]>>(new Map());

  useRenderProfiler("AiVoiceMemorySettingsCard", {
    isActive,
    modelCount: snapshot?.models.length ?? 0,
    snapshotRevision: snapshot?.checkedAt,
    busyModel,
  });

  useEffect(() => {
    if (!isActive) return;
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
    void preloadAiVoiceMemorySnapshot()
      .then((next) => active && setSnapshot(next))
      .catch(() =>
        pushToast({
          tone: "danger",
          title: "模型状态读取失败",
          description: "请完全退出并重新打开上号。",
        }),
      );
    const unsubscribe = aiApi.onStatus((next) => {
      cachedAiVoiceMemorySnapshot = next;
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isActive, pushToast]);

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    let firstFrame = 0;
    let secondFrame = 0;
    let idleId: number | undefined;
    let timerId: number | undefined;
    const aiApi = window.desktopApi.ai;
    if (!aiApi || typeof aiApi.getRuntimeStatus !== "function") return;

    const refresh = () => {
      void aiApi
        .getRuntimeStatus()
        .then((next) => active && setRuntimeStatus(next))
        .catch(() => undefined);
    };

    // Runtime discovery touches every local model directory. Let the visible page paint first,
    // refresh once, and then rely on the model status subscription for real changes.
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (typeof window.requestIdleCallback === "function") {
          idleId = window.requestIdleCallback(refresh, { timeout: 2_000 });
        } else {
          timerId = window.setTimeout(refresh, 350);
        }
      });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (!pendingDeleteModel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busyModel !== pendingDeleteModel.id) {
        setPendingDeleteModel(undefined);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busyModel, isActive, pendingDeleteModel]);

  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive]);

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
    if (model.category !== "asr" || !model.activeRevision || !model.runtimeReady) return;
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

  const openHuggingFacePage = async (url: string) => {
    try {
      await window.desktopApi.app.openExternal(url);
    } catch {
      try {
        await window.desktopApi.clipboard.writeText(url);
        pushToast({
          tone: "neutral",
          title: "浏览器没有自动打开",
          description: "链接已复制，请粘贴到 Chrome、Edge 或其他浏览器打开。",
        });
      } catch {
        pushToast({
          tone: "danger",
          title: "网页打开失败",
          description: "请手动复制授权区域下方的 Hugging Face 地址到浏览器打开。",
        });
      }
    }
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
      setHuggingFaceAccessModel(undefined);
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

  // Keep the manifest order stable. Selecting a model only changes its state styling;
  // it must never move the card the user is looking at.
  const asrModels = models.filter((model) => model.category === "asr");
  const supportModels = models.filter((model) => model.category === "support");
  const organizerModels = models.filter((model) => model.category === "organizer");
  const organizerModel = organizerModels.find((model) => model.id === "qwen36-35b-a3b-nvfp4");
  const selectedAsr = asrModels.find((model) => model.id === settings.aiAsrModel);
  const asrRuntimeStatus = runtimeStatus?.asr;
  const selectedAsrReady = Boolean(
    selectedAsr?.activeRevision && (selectedAsr.runtimeReady ?? asrRuntimeStatus?.ready),
  );
  const qwenInstalled = Boolean(organizerModel?.activeRevision);
  const organizerReady =
    settings.aiOrganizerProvider === "local"
      ? Boolean(qwenInstalled && organizerModel?.runtimeReady)
      : settings.aiOrganizerProvider === "custom"
        ? Boolean(customProvider?.configured)
        : true;
  const showCustomProvider = settings.aiOrganizerProvider === "custom";
  const installedAsrCount = asrModels.filter((model) => model.activeRevision).length;
  const installedOrganizerCount = organizerModels.filter((model) => model.activeRevision).length;

  const chooseAsrModel = (model: AiModelStatus) => {
    if (model.id === settings.aiAsrModel) return;
    if (!model.activeRevision) {
      pushToast({
        tone: "neutral",
        title: `${model.name} 尚未安装`,
        description: "请先下载模型。",
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
        title: `${model.name} 正在准备`,
        description: dependencyPending ? "正在准备所需文件。" : "软件会自动完成，请稍后重试。",
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
    const selectable = model.category === "asr";
    const selected = model.id === settings.aiAsrModel;
    const tags = MODEL_TAGS[model.id] ?? [];
    const dependencyPending = Boolean(
      model.dependencies?.some((dependencyId) => {
        const dependency = models.find((candidate) => candidate.id === dependencyId);
        return !dependency || dependency.phase !== "installed" || !dependency.runtimeReady;
      }),
    );
    // Only an installed and runnable ASR model has a card-level selection target.
    // Download/repair/delete remain a separate action segment and must never be
    // intercepted by the transparent selection layer.
    const canSelect =
      selectable && Boolean(model.activeRevision && model.runtimeReady && !dependencyPending);
    const showProgress =
      model.totalBytes > 0 && model.phase !== "not_installed" && model.phase !== "installed";
    const compactStatus = model.errorMessage
      ? model.failureKind === "integrity"
        ? "文件校验失败，可修复"
        : model.failureKind === "network"
          ? "下载中断，可继续"
          : model.failureKind === "disk"
            ? "模型磁盘空间不足"
            : model.failureKind === "access"
              ? "需要完成下载授权"
              : "模型操作未完成，可重试"
      : model.activeRevision && !model.runtimeReady && model.runtimeMessage
        ? dependencyPending
          ? "等待共享组件"
          : "正在自动准备"
        : model.inferenceBackend === "freetoken" && model.runtimeMetrics
          ? `${
              model.runtimeMetrics.phase === "starting" || model.runtimeMetrics.phase === "loading"
                ? "正在准备"
                : model.runtimeMetrics.phase === "running"
                  ? "正在整理"
                  : model.runtimeMetrics.phase === "error"
                    ? "暂时不可用，使用时自动重试"
                    : "使用时自动加载"
            }${
              model.runtimeMetrics.tokensPerSecond !== undefined
                ? ` · ${model.runtimeMetrics.tokensPerSecond.toFixed(1)} token/s`
                : ""
            }`
          : "";
    const technicalDetails = [
      `${model.purpose} · 约 ${formatBytes(model.approximateBytes)}`,
      tags.length > 0 ? `特点：${tags.join("、")}` : "",
      model.dependencies?.includes("qwen3-forced-aligner-0.6b")
        ? "需要共用时间对齐组件，不会重复下载。"
        : "",
      model.optionalDependencies?.includes("qwen3-forced-aligner-0.6b")
        ? "安装 ForcedAligner 后自动精确对齐；未安装也可转录。"
        : "",
      model.hardwareNote ?? "",
      model.errorMessage ?? "",
      model.runtimeMessage ?? "",
      model.inferenceBackend === "freetoken" && model.runtimeMetrics
        ? [
            "本地运行",
            localRuntimePhaseLabel(model.runtimeMetrics.phase),
            model.runtimeMetrics.gpuMemoryMb !== undefined
              ? `GPU ${model.runtimeMetrics.gpuMemoryMb.toFixed(0)} MB`
              : "",
            model.runtimeMetrics.ramMemoryMb !== undefined
              ? `RAM ${model.runtimeMetrics.ramMemoryMb.toFixed(0)} MB`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <article
        className={`ai-model-card is-${model.category}${canSelect ? " is-selectable" : ""}${selected ? " is-selected" : ""}`}
        data-model-id={model.id}
        data-model-phase={model.phase}
        title={technicalDetails}
        aria-busy={
          model.phase === "queued" ||
          model.phase === "downloading" ||
          model.phase === "checking" ||
          model.phase === "verifying" ||
          model.phase === "preparing"
        }
        key={model.id}
      >
        {canSelect ? (
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
          <div className="ai-model-header">
            <div className="ai-model-title-row">
              <span className="ai-model-icon" aria-hidden="true">
                <BrainCircuit />
              </span>
              <div className="ai-model-primary">
                <h3 className="text-balance">{model.name}</h3>
                <p className="ai-model-summary text-pretty">
                  {model.purpose} · 约 {formatBytes(model.approximateBytes)}
                </p>
              </div>
              <strong className={`ai-model-phase is-${selected ? "selected" : model.phase}`}>
                {selected ? "当前使用" : modelPhaseLabel(model)}
              </strong>
            </div>
            <div className="ai-model-actions">
              <ModelActions
                model={model}
                busy={busyModel === model.id}
                dependencyPending={dependencyPending}
                onAction={(action) => void controlModel(model, action)}
                onConfigureAccess={() => setHuggingFaceAccessModel(model)}
              />
            </div>
          </div>
          <div
            className={`ai-model-card-footer${
              compactStatus
                ? model.errorMessage || (!model.runtimeReady && !dependencyPending)
                  ? " is-error"
                  : " is-info"
                : ""
            }`}
            aria-live={model.errorMessage ? "polite" : "off"}
          >
            {showProgress ? (
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
                  {modelProgressPercent(model)}% · {formatBytes(model.downloadedBytes)} /{" "}
                  {formatBytes(model.totalBytes)}
                  {model.phase === "verifying"
                    ? " · 正在校验"
                    : model.phase === "preparing"
                      ? " · 正在准备"
                      : ""}
                  {model.phase === "downloading" && model.bytesPerSecond
                    ? ` · ${formatBytes(model.bytesPerSecond)}/s${snapshot?.scheduler.gameActive ? "（游戏中已降速）" : ""}`
                    : ""}
                </small>
              </div>
            ) : null}
            {compactStatus ? (
              <p className="ai-model-card-status" title={technicalDetails}>
                {compactStatus}
              </p>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  if (!snapshot) {
    return (
      <SettingsSection title="AI 功能">
        <div className="ai-settings-loading" role="status" aria-label="正在准备 AI 功能">
          <span className="ai-settings-loading-spinner" aria-hidden="true" />
          <strong>正在准备 AI 功能…</strong>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="AI 功能">
      <section className="ai-overview" aria-labelledby="ai-overview-title">
        <div className="ai-model-group-heading">
          <h3 id="ai-overview-title">当前使用</h3>
        </div>
        <div className="ai-overview-grid">
          <article>
            <small>默认转录</small>
            <strong>{selectedAsr?.name ?? "未选择"}</strong>
          </article>
          <article>
            <small>录音整理</small>
            <strong>
              {settings.aiOrganizerProvider === "cloud"
                ? "房间云端 AI"
                : settings.aiOrganizerProvider === "local"
                  ? "本地 Qwen3.6-35B-A3B"
                  : "自定义 API"}
            </strong>
          </article>
          <article>
            <small>房间问答</small>
            <strong>房间云端 AI</strong>
          </article>
          <article>
            <small>已安装</small>
            <strong>
              {installedAsrCount} 个转录 · {installedOrganizerCount} 个整理
            </strong>
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
          <h3 id="model-management-title">模型</h3>
        </div>
        <div className="ai-model-subgroup">
          <div className="ai-model-subgroup-heading">
            <strong>转录</strong>
          </div>
          <div className="ai-model-management-grid">{asrModels.map(renderModel)}</div>
        </div>
        <div className="ai-model-subgroup is-compact">
          <div className="ai-model-subgroup-heading">
            <strong>共享组件</strong>
          </div>
          <div className="ai-model-management-grid">{supportModels.map(renderModel)}</div>
        </div>
        <div className="ai-model-subgroup">
          <div className="ai-model-subgroup-heading">
            <strong>整理</strong>
          </div>
          <div className="ai-model-management-grid">{organizerModels.map(renderModel)}</div>
        </div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="transcription-settings-title">
        <div className="ai-model-group-heading">
          <h3 id="transcription-settings-title">转录设置</h3>
        </div>
        <div className="mt-3 space-y-3">
          <SettingsItemRow
            label="转录时机"
            description={snapshot?.scheduler.gameActive ? "游戏中将自动降低后台占用。" : undefined}
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
            description={selectedAsrReady ? undefined : "当前转录模型未就绪。"}
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
          <h3 id="ai-analysis-title">整理与问答</h3>
        </div>
        <div className="mt-3 space-y-3">
          <SettingsItemRow label="录音整理模型">
            {providerSelect(settings.aiOrganizerProvider, "aiOrganizerProvider", "整理内容方式")}
          </SettingsItemRow>
          <SettingsItemRow label="房间问答模型">
            <span className="ai-cloud-provider-badge">房间云端 AI</span>
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
                密钥经 Windows 加密，仅保存在本机。仅支持 HTTPS 地址。
              </p>
            </div>
          ) : null}
          <SettingsItemRow
            label="自动整理"
            description={
              organizerReady
                ? undefined
                : settings.aiOrganizerProvider === "local"
                  ? "本地整理模型未就绪。"
                  : "请先保存自定义 API。"
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
      {huggingFaceAccessModel
        ? createPortal(
            <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-6">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="hugging-face-access-title"
                aria-describedby="hugging-face-access-description"
                className="modal-surface relative w-full max-w-[560px] rounded-[26px] p-6"
              >
                <DialogCloseButton
                  className="absolute right-4 top-4"
                  label="关闭模型下载授权"
                  disabled={savingHuggingFaceAccess}
                  onClick={() => setHuggingFaceAccessModel(undefined)}
                />
                <h2
                  id="hugging-face-access-title"
                  className="pr-12 text-balance text-[22px] font-bold text-[#172235]"
                >
                  下载 {huggingFaceAccessModel.name}
                </h2>
                <p
                  id="hugging-face-access-description"
                  className="mt-2 text-pretty text-sm leading-6 text-[#66778d]"
                >
                  这是 Hugging Face 门控模型，首次下载需要完成官方授权。
                </p>
                <div className="ai-model-access-panel mt-5" aria-label="Cohere 模型下载授权">
                  <div className="ai-model-access-heading">
                    <KeyRound aria-hidden="true" />
                    <div>
                      <strong>授权只需配置一次</strong>
                      <span>
                        {huggingFaceAccess?.configured
                          ? "本机已保存授权，可直接继续下载"
                          : "先接受条款，再创建一个只读 Token"}
                      </span>
                    </div>
                  </div>
                  <div className="ai-model-access-steps">
                    <Button
                      variant="secondary"
                      onClick={() => void openHuggingFacePage(COHERE_TERMS_URL)}
                    >
                      1. 接受模型条款 <ExternalLink aria-hidden="true" />
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void openHuggingFacePage(HUGGING_FACE_TOKENS_URL)}
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
                          ? "已安全保存；需要更换时再粘贴"
                          : "粘贴以 hf_ 开头的只读 Token"
                      }
                      onChange={(event) => setHuggingFaceToken(event.target.value)}
                    />
                    <Button
                      disabled={savingHuggingFaceAccess || busyModel === huggingFaceAccessModel.id}
                      onClick={() => void handleHuggingFaceAccess(huggingFaceAccessModel)}
                    >
                      <Download aria-hidden="true" />
                      {huggingFaceToken.trim()
                        ? "保存并下载"
                        : huggingFaceAccess?.configured
                          ? "继续下载"
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
                    Token 由 Windows 加密后保存在本机，仅用于 Hugging Face
                    下载，不会上传到上号服务器。
                  </small>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
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
