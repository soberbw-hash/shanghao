import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  BrainCircuit,
  ChevronDown,
  Download,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from "lucide-react";

import type {
  AiAsrModelId,
  AiModelAction,
  AiModelId,
  AiModelStatus,
  AiRuntimeStatus,
  AiCustomProviderStatus,
  AiTranscriptionProvider,
  AiTranscriptionProviderStatus,
  AiVoiceMemorySnapshot,
  AppSettings,
} from "@private-voice/shared";
import { AI_ASR_PRODUCT_CLASSES, DEFAULT_AI_ASR_MODEL_ID } from "@private-voice/shared";

import { modelPhaseLabel, modelProgressPercent } from "../../features/ai/modelDownloadPresentation";
import { playUiSound } from "../../features/audio/uiSound";
import { useRenderProfiler } from "../../features/diagnostics/renderProfiler";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";
import { CloudLocalAssistControl } from "./CloudLocalAssistControl";
import { TranscriptionDataNotice } from "./TranscriptionDataNotice";
import type { ToastMessage } from "../../store/appStore";
import { toUserFacingError } from "../../utils/userFacingError";
import { canReuseTextProviderKey, type TextModelPreset } from "../../features/ai/textModelPreset";

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
  "moss-transcribe-diarize-0.9b-q8_0": ["多人转录", "说话人区分", "时间戳", "Q8_0"],
  "ark-asr-3b-q8_0": ["多语言", "高质量", "Q8_0", "CUDA"],
  "qwen3-forced-aligner-0.6b": ["共享组件", "精确对齐"],
  "qwen35-4b": ["本地整理", "总结", "章节"],
  "qwen36-35b-a3b-nvfp4": ["本地整理", "MoE", "3B Active", "NVFP4"],
};

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
}: {
  model: AiModelStatus;
  busy: boolean;
  dependencyPending: boolean;
  onAction: (action: AiModelAction) => void;
}) => {
  const runAction = (event: MouseEvent<HTMLButtonElement>, action: AiModelAction) => {
    event.stopPropagation();
    const menu = event.currentTarget.closest("details");
    if (menu) menu.open = false;
    onAction(action);
  };
  if (model.phase === "not_installed") {
    return (
      <Button
        variant="secondary"
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
        <details
          className="ai-model-action-menu"
          onClick={(event) => event.stopPropagation()}
          onMouseLeave={(event) => {
            event.currentTarget.open = false;
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              event.currentTarget.open = false;
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label={`管理 ${model.name}`}>
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </summary>
          <div>
            {model.category !== "support" &&
            !model.runtimeReady &&
            !dependencyPending &&
            (model.id !== "qwen36-35b-a3b-nvfp4" || model.runtimeMetrics?.phase === "error") ? (
              <button type="button" disabled={busy} onClick={(event) => runAction(event, "repair")}>
                重试 / 修复
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={(event) => runAction(event, "delete")}>
              <Trash2 className="size-4" aria-hidden="true" /> 删除模型
            </button>
          </div>
        </details>
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
  const modelInUse = !snapshot || Boolean(snapshot.modelConfigurationBusy);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<AiModelStatus>();
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus>();
  const [customProvider, setCustomProvider] = useState<AiCustomProviderStatus>();
  const [transcriptionStatus, setTranscriptionStatus] = useState<AiTranscriptionProviderStatus>();
  const [providerReload, setProviderReload] = useState(0);
  const [textConfigError, setTextConfigError] = useState(false);
  const [transcriptionConfigState, setTranscriptionConfigState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [transcriptionBaseUrl, setTranscriptionBaseUrl] = useState("https://api.example.com/v1");
  const [transcriptionModel, setTranscriptionModel] = useState("whisper-1");
  const [transcriptionApiKey, setTranscriptionApiKey] = useState("");
  const [savingTranscriptionProvider, setSavingTranscriptionProvider] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [textPreset, setTextPreset] = useState<TextModelPreset>(
    settings.aiOrganizerProvider === "cloud" ? "cloud" : "custom",
  );
  const textPresetEdited = useRef(false);
  const [savingCustomProvider, setSavingCustomProvider] = useState(false);
  const [modelFilter, setModelFilter] = useState<"all" | "installed" | "available">("all");
  const previousModelPhasesRef = useRef<Map<AiModelId, AiModelStatus["phase"]>>(new Map());

  useRenderProfiler("AiVoiceMemorySettingsCard", {
    isActive,
    modelCount: snapshot?.models.length ?? 0,
    snapshotRevision: snapshot?.checkedAt,
    busyModel,
  });

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
    setTextConfigError(false);
    void window.desktopApi.ai
      .getCustomProvider()
      .then((status) => {
        if (!active) return;
        setCustomProvider(status);
        if (textPresetEdited.current) return;
        setCustomBaseUrl(status.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4");
        setCustomModel(status.model ?? "glm-4-flash-250414");
        setTextPreset(settings.aiOrganizerProvider === "cloud" ? "cloud" : "custom");
      })
      .catch(() => {
        if (!active) return;
        setTextConfigError(true);
        pushToast({
          tone: "danger",
          title: "自定义 API 配置无法读取",
          description: "原配置文件已保留，请检查系统加密存储或磁盘权限。",
        });
      });
    return () => {
      active = false;
    };
  }, [isActive, pushToast, settings.aiOrganizerProvider, providerReload]);

  useEffect(() => {
    if (!isActive) return;
    let active = true;
    setTranscriptionConfigState("loading");
    void window.desktopApi.ai
      .getTranscriptionProvider()
      .then((status) => {
        if (!active) return;
        setTranscriptionStatus(status);
        setTranscriptionConfigState("ready");
        setTranscriptionBaseUrl(status.customBaseUrl ?? "https://api.example.com/v1");
        setTranscriptionModel(status.customModel ?? "whisper-1");
      })
      .catch(() => {
        if (active) setTranscriptionConfigState("error");
      });
    return () => {
      active = false;
    };
  }, [isActive, providerReload]);

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
      if (
        action === "delete" &&
        model.id === settings.aiAsrModel &&
        settings.aiTranscriptionProvider === "local"
      ) {
        await onChange({
          isAiAutoTranscribeEnabled: false,
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
    if (modelInUse) return;
    if (model.category !== "asr" || !model.activeRevision || !model.runtimeReady) return;
    setBusyModel(model.id);
    try {
      await onChange({ aiAsrModel: model.id as AiAsrModelId, aiTranscriptionProvider: "local" });
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
    if (modelInUse) return;
    setSavingCustomProvider(true);
    try {
      if (textPreset === "cloud") {
        await onChange({
          aiOrganizerProvider: "cloud",
          aiRoomAskProvider: "cloud",
          aiTextModelPreset: "cloud",
        });
        pushToast({ tone: "success", title: "内置云端模型已生效" });
        return;
      }
      const status = await window.desktopApi.ai.saveCustomProvider({
        baseUrl: customBaseUrl,
        model: customModel,
        apiKey: customApiKey || undefined,
      });
      const preset = "custom";
      await onChange({
        aiOrganizerProvider: "custom",
        aiRoomAskProvider: "custom",
        aiTextModelPreset: preset,
      });
      setTextPreset(preset);
      setCustomProvider(status);
      setCustomApiKey("");
      pushToast({ tone: "success", title: "自定义 API 已安全保存" });
    } catch (error) {
      const existingConfigUnreadable =
        /custom_ai_config_(?:invalid|unreadable)|custom_ai_encryption_unavailable|EACCES|EISDIR/u.test(
          String(error),
        );
      pushToast({
        tone: "danger",
        title: "文本模型保存失败",
        description: existingConfigUnreadable
          ? "原配置无法读取，已保留原文件。请检查系统加密存储或磁盘权限。"
          : textPreset === "cloud"
            ? "模型没有切换，请重试保存。"
            : "请检查 API 地址、模型名称和密钥是否填写正确，然后重试。",
      });
    } finally {
      setSavingCustomProvider(false);
    }
  };

  const saveTranscriptionProvider = async (provider: "cloud" | "custom") => {
    if (modelInUse) return;
    setSavingTranscriptionProvider(true);
    try {
      const status = await window.desktopApi.ai.saveTranscriptionProvider({
        provider,
        apiKey: transcriptionApiKey || undefined,
        ...(provider === "custom"
          ? { baseUrl: transcriptionBaseUrl, model: transcriptionModel }
          : {}),
      });
      setTranscriptionStatus(status);
      setTranscriptionConfigState("ready");
      setTranscriptionApiKey("");
      pushToast({ tone: "success", title: "转录 API 已安全保存" });
    } catch {
      pushToast({
        tone: "danger",
        title: "转录 API 保存失败",
        description: "请检查 API 地址、模型名称和密钥后重试。",
      });
    } finally {
      setSavingTranscriptionProvider(false);
    }
  };

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
    let observedStatus = false;
    void preloadAiVoiceMemorySnapshot()
      .then((next) => active && !observedStatus && setSnapshot(next))
      .catch(() =>
        pushToast({
          tone: "danger",
          title: "模型状态读取失败",
          description: "请完全退出并重新打开上号。",
        }),
      );
    const unsubscribe = aiApi.onStatus((next) => {
      observedStatus = true;
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

  // Pin the recommendation at the top of its group. Selection and download
  // state never move a card the user is looking at.
  const asrModels = models.filter((model) => model.category === "asr");
  const supportModels = models.filter((model) => model.category === "support");
  const visibleModel = (model: AiModelStatus): boolean =>
    modelFilter === "all" ||
    (modelFilter === "installed" ? Boolean(model.activeRevision) : !model.activeRevision);
  const selectedAsr = asrModels.find((model) => model.id === settings.aiAsrModel);
  const asrRuntimeStatus = runtimeStatus?.asr;
  const selectedAsrReady = Boolean(
    selectedAsr?.activeRevision && (selectedAsr.runtimeReady ?? asrRuntimeStatus?.ready),
  );
  const transcriptionProvider = settings.aiTranscriptionProvider ?? "cloud";
  const canReuseTranscriptionKey = canReuseTextProviderKey(
    {
      configured: Boolean(transcriptionStatus?.customConfigured),
      hasApiKey: Boolean(transcriptionStatus?.customConfigured),
      baseUrl: transcriptionStatus?.customBaseUrl,
    },
    transcriptionBaseUrl,
  );
  const activeTranscriptionReady =
    transcriptionProvider === "local"
      ? selectedAsrReady
      : transcriptionConfigState === "ready" &&
        (transcriptionProvider === "cloud"
          ? Boolean(transcriptionStatus?.cloudConfigured)
          : Boolean(transcriptionStatus?.customConfigured));
  const installedAsrCount = asrModels.filter((model) => model.activeRevision).length;
  const transcriptionName =
    transcriptionProvider === "cloud"
      ? "SenseVoiceSmall 云端"
      : transcriptionProvider === "custom"
        ? (transcriptionStatus?.customModel ?? "自定义转录 API")
        : (selectedAsr?.name ?? "未选择");
  const textModelName =
    settings.aiOrganizerProvider === "custom"
      ? textConfigError
        ? "配置读取失败"
        : customProvider
          ? (customProvider.model ?? "自定义 API（未配置）")
          : "正在读取配置…"
      : "内置 GLM-4-Flash";

  const chooseAsrModel = (model: AiModelStatus) => {
    if (settings.aiTranscriptionProvider === "local" && model.id === settings.aiAsrModel) return;
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
        title: `${model.name} 运行组件未就绪`,
        description: dependencyPending
          ? "请先完成共享组件的安装。"
          : (model.runtimeMessage ?? "请在模型菜单中点击“重试 / 修复”。"),
      });
      return;
    }
    void selectAsrModel(model);
  };

  const renderModel = (model: AiModelStatus) => {
    const selectable = model.category === "asr";
    const selected =
      settings.aiTranscriptionProvider === "local" && model.id === settings.aiAsrModel;
    const recommended = model.id === DEFAULT_AI_ASR_MODEL_ID;
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
          : model.phase === "preparing"
            ? "正在准备运行组件"
            : "运行组件未就绪，点击菜单修复"
        : model.activeRevision && model.inferenceBackend === "freetoken" && model.runtimeMetrics
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
        className={`ai-model-card is-${model.category}${canSelect ? " is-selectable" : ""}${selected ? " is-selected" : ""}${recommended ? " is-recommended" : ""}`}
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
            disabled={modelInUse || busyModel === model.id || selected}
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
                <div className="ai-model-name-line">
                  <h3 className="text-balance">{model.name}</h3>
                  {recommended ? (
                    <span
                      className="ai-model-recommendation"
                      title="新建配置默认选择；已有选择不会改变"
                    >
                      默认推荐
                    </span>
                  ) : null}
                </div>
                <p className="ai-model-summary text-pretty">
                  {model.purpose} · 约 {formatBytes(model.approximateBytes)}
                </p>
              </div>
              <strong className={`ai-model-phase is-${selected ? "selected" : model.phase}`}>
                {selected
                  ? canSelect
                    ? "当前使用"
                    : `已选 · ${modelPhaseLabel(model)}`
                  : modelPhaseLabel(model)}
              </strong>
            </div>
            <div className="ai-model-actions">
              <ModelActions
                model={model}
                busy={busyModel === model.id}
                dependencyPending={dependencyPending}
                onAction={(action) => void controlModel(model, action)}
              />
            </div>
          </div>
          <div
            className={`ai-model-card-footer${
              compactStatus
                ? model.errorMessage || model.runtimeMetrics?.phase === "error"
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
            <small>已选转录模型</small>
            <strong>{transcriptionName}</strong>
          </article>
          <article>
            <small>录音整理</small>
            <strong>{textModelName}</strong>
          </article>
          <article>
            <small>房间问答</small>
            <strong>{textModelName}</strong>
          </article>
          <article>
            <small>已安装</small>
            <strong>{installedAsrCount} 个转录</strong>
          </article>
        </div>
      </section>

      <section className="ai-model-group mt-3" aria-labelledby="transcription-settings-title">
        <div className="ai-model-group-heading">
          <h3 id="transcription-settings-title">转录设置</h3>
        </div>
        <div className="mt-3 space-y-3">
          {transcriptionProvider === "local" ? (
            <SettingsItemRow
              label="转录时机"
              description={
                snapshot?.scheduler.gameActive ? "游戏中将自动降低后台占用。" : undefined
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
          ) : (
            <p className="text-xs text-[#718096]">
              云端直接处理，不等待游戏结束；切换本地后按所选时机和电脑资源自动调度。
            </p>
          )}
          <SettingsItemRow
            label="自动转录"
            description={
              activeTranscriptionReady
                ? undefined
                : transcriptionProvider !== "local" && transcriptionConfigState !== "ready"
                  ? transcriptionConfigState === "error"
                    ? "密钥配置暂时无法读取，原文件已保留；可在下方重试读取。"
                    : "正在读取本机密钥配置…"
                  : transcriptionProvider === "local"
                    ? "当前本地转录模型未就绪。"
                    : "请先配置当前转录 API 密钥。"
            }
          >
            <Switch
              isChecked={settings.isAiAutoTranscribeEnabled}
              ariaLabel="自动转录"
              onChange={(checked) => void onChange({ isAiAutoTranscribeEnabled: checked })}
            />
          </SettingsItemRow>
          <TranscriptionDataNotice
            provider={transcriptionProvider}
            automatic={settings.isAiAutoTranscribeEnabled}
          />
          <CloudLocalAssistControl
            settings={settings}
            disabled={modelInUse}
            models={snapshot.models}
            onChange={(patch) => void onChange(patch)}
          />
        </div>
      </section>

      <details
        id="ai-model-management"
        className="ai-model-group ai-advanced-settings mt-3 scroll-mt-4"
      >
        <summary className="ai-advanced-summary" aria-label="模型与 API 配置">
          <span>
            <strong>模型与 API 配置</strong>
            <small>按需更改 API、下载或管理本地模型</small>
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </summary>
        <div className="ai-model-group-heading">
          <h3 id="model-management-title">模型</h3>
          {transcriptionProvider === "local" ? (
            <div className="ai-model-filter-bar" role="group" aria-label="筛选模型">
              {(
                [
                  ["all", "全部"],
                  ["installed", "已安装"],
                  ["available", "可安装"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={modelFilter === value}
                  onClick={() => setModelFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ai-model-provider-grid mt-3">
          <fieldset
            className="ai-model-provider-panel disabled:opacity-50"
            disabled={modelInUse}
            aria-label="文本整理与问答模型"
            title={modelInUse ? "AI 任务进行中，结束后可切换模型" : undefined}
          >
            <h4>文本整理与问答</h4>
            <p>只处理文字，用于摘要、融合校对与问答。当前使用：{textModelName}。</p>
            {textConfigError ? (
              <p role="alert">
                本机密钥配置读取失败，原文件已保留。
                <button type="button" onClick={() => setProviderReload((n) => n + 1)}>
                  重试读取
                </button>
              </p>
            ) : null}
            <select
              className="ai-processing-select"
              aria-label="文本整理与问答模型"
              value={textPreset}
              disabled={savingCustomProvider}
              onChange={(event) => {
                const value = event.target.value as NonNullable<AppSettings["aiTextModelPreset"]>;
                textPresetEdited.current = true;
                setTextPreset(value);
                setCustomApiKey("");
              }}
            >
              <option value="cloud">内置云端 · GLM-4-Flash</option>
              <option value="custom">自定义 API</option>
            </select>
            {textPreset === "cloud" ? (
              <div className="ai-provider-config-note">
                <p>开发者提供；登录后自动生成摘要，房间问答使用当前房间的记忆。</p>
                <Button
                  aria-label="保存文本模型配置"
                  disabled={savingCustomProvider}
                  onClick={() => void saveCustomProvider()}
                >
                  保存
                </Button>
              </div>
            ) : customProvider && !textConfigError ? (
              <div className="ai-provider-config-note">
                <div className="ai-provider-fields">
                  <label className="min-w-0 flex-1 text-sm font-medium text-[#26364d]">
                    API 地址
                    <input
                      className="mt-1 w-full rounded-xl border border-[#d7e4f4] bg-white px-3 py-2 text-sm"
                      value={customBaseUrl}
                      disabled={savingCustomProvider}
                      onChange={(event) => {
                        setCustomBaseUrl(event.target.value);
                        setTextPreset("custom");
                      }}
                      placeholder="https://api.example.com/v1"
                    />
                  </label>
                  <label className="min-w-0 flex-1 text-sm font-medium text-[#26364d]">
                    模型名称
                    <input
                      className="mt-1 w-full rounded-xl border border-[#d7e4f4] bg-white px-3 py-2 text-sm"
                      value={customModel}
                      disabled={savingCustomProvider}
                      onChange={(event) => {
                        setCustomModel(event.target.value);
                        setTextPreset("custom");
                      }}
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
                      disabled={savingCustomProvider}
                      onChange={(event) => setCustomApiKey(event.target.value)}
                      placeholder={
                        canReuseTextProviderKey(customProvider, customBaseUrl)
                          ? "已保存；留空不修改"
                          : "请输入此服务的密钥"
                      }
                    />
                  </label>
                  <div className="ai-provider-form-actions">
                    <Button
                      aria-label="保存文本模型配置"
                      disabled={
                        savingCustomProvider ||
                        (!customApiKey.trim() &&
                          !canReuseTextProviderKey(customProvider, customBaseUrl))
                      }
                      onClick={() => void saveCustomProvider()}
                    >
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
                  密钥经 Windows 加密，仅保存在本机；正式版与开发版独立保存，不会同步到服务器。
                </p>
              </div>
            ) : null}
          </fieldset>
          <fieldset
            className="ai-model-provider-panel disabled:opacity-50"
            disabled={modelInUse}
            aria-label="语音转录模型"
            title={modelInUse ? "AI 任务进行中，结束后可切换模型" : undefined}
          >
            <h4>语音转文字</h4>
            <p>SenseVoice 在云端识别音频；Qwen 等本地模型可单独转录或辅助校对时间轴。</p>
            <select
              className="ai-processing-select"
              aria-label="语音转录模型来源"
              value={transcriptionProvider}
              onChange={(event) => {
                setTranscriptionApiKey("");
                void onChange({
                  aiTranscriptionProvider: event.target.value as AiTranscriptionProvider,
                });
              }}
            >
              <option value="cloud">内置云端 · SenseVoice</option>
              <option value="local">本地转录 · 使用已下载模型</option>
              <option value="custom">自定义语音 API</option>
            </select>
            {transcriptionProvider !== "local" && transcriptionConfigState !== "ready" ? (
              <div className="ai-provider-config-note" role="status">
                <span>
                  {transcriptionConfigState === "loading"
                    ? "正在读取本机密钥配置…"
                    : "密钥配置读取失败，原文件已保留；这不代表密钥已丢失。"}
                </span>
                {transcriptionConfigState === "error" ? (
                  <Button variant="ghost" onClick={() => setProviderReload((n) => n + 1)}>
                    重试读取
                  </Button>
                ) : null}
              </div>
            ) : null}
            {transcriptionProvider === "cloud" && transcriptionConfigState === "ready" ? (
              <div className="ai-provider-config-note">
                <p>
                  {transcriptionStatus?.cloudConfigured
                    ? "开发者提供，登录后即可使用，无需填写密钥。"
                    : transcriptionStatus?.cloudErrorCode === "cloud_asr_backend_upgrade_required"
                      ? "云端转录接口尚未部署，需要更新服务器后台。暂时可使用本地模型或自定义语音 API。"
                      : "服务器转录服务暂未就绪，请稍后重试或切换本地模型。"}
                </p>
              </div>
            ) : null}
            {transcriptionProvider === "custom" && transcriptionStatus?.customConfigUnreadable ? (
              <p role="alert">
                自定义密钥配置无法读取，原文件已保留。
                <button type="button" onClick={() => setProviderReload((n) => n + 1)}>
                  重试读取
                </button>
              </p>
            ) : null}
            {transcriptionProvider === "custom" &&
            transcriptionConfigState === "ready" &&
            !transcriptionStatus?.customConfigUnreadable ? (
              <div className="ai-provider-config-note">
                <div className="ai-provider-fields">
                  <label>
                    API 地址
                    <input
                      className="ai-provider-key-input"
                      aria-label="转录 API 地址"
                      value={transcriptionBaseUrl}
                      onChange={(event) => setTranscriptionBaseUrl(event.target.value)}
                      placeholder="https://api.example.com/v1"
                    />
                  </label>
                  <label>
                    模型名称
                    <input
                      className="ai-provider-key-input"
                      aria-label="转录模型 ID"
                      value={transcriptionModel}
                      onChange={(event) => setTranscriptionModel(event.target.value)}
                      placeholder="模型 ID"
                    />
                  </label>
                  <label>
                    API 密钥
                    <input
                      className="ai-provider-key-input"
                      aria-label="转录 API 密钥"
                      type="password"
                      autoComplete="off"
                      value={transcriptionApiKey}
                      onChange={(event) => setTranscriptionApiKey(event.target.value)}
                      placeholder={
                        canReuseTranscriptionKey ? "已保存；留空不修改" : "请输入此服务的密钥"
                      }
                    />
                  </label>
                  <div className="ai-provider-form-actions">
                    <Button
                      disabled={
                        savingTranscriptionProvider ||
                        (!transcriptionApiKey.trim() && !canReuseTranscriptionKey)
                      }
                      onClick={() => void saveTranscriptionProvider("custom")}
                    >
                      保存转录 API
                    </Button>
                  </div>
                </div>
                <p>密钥经 Windows 加密，仅保存在本机。仅支持 HTTPS 地址。</p>
              </div>
            ) : null}
          </fieldset>
        </div>
        {transcriptionProvider === "local" ? (
          <>
            {(["high_accuracy", "high_speed"] as const).map((category) => (
              <div className="ai-model-subgroup" key={category}>
                <div className="ai-model-subgroup-heading">
                  <strong>{category === "high_accuracy" ? "高精度转录" : "极速转录"}</strong>
                </div>
                <div className="ai-model-management-grid">
                  {asrModels
                    .filter(
                      (model) =>
                        AI_ASR_PRODUCT_CLASSES[model.id as AiAsrModelId] === category &&
                        visibleModel(model),
                    )
                    .sort(
                      (left, right) =>
                        Number(right.id === DEFAULT_AI_ASR_MODEL_ID) -
                        Number(left.id === DEFAULT_AI_ASR_MODEL_ID),
                    )
                    .map(renderModel)}
                </div>
              </div>
            ))}
            <div className="ai-model-subgroup is-compact">
              <div className="ai-model-subgroup-heading">
                <strong>共享组件</strong>
              </div>
              <div className="ai-model-management-grid">
                {supportModels.filter(visibleModel).map(renderModel)}
              </div>
            </div>
          </>
        ) : null}
      </details>

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
