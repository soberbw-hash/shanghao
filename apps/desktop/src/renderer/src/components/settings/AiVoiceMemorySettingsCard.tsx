import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Download, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";

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
import { AI_ASR_PRODUCT_CLASSES, DEFAULT_AI_ASR_MODEL_ID } from "@private-voice/shared";

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
  const [pendingDeleteModel, setPendingDeleteModel] = useState<AiModelStatus>();
  const [runtimeStatus, setRuntimeStatus] = useState<AiRuntimeStatus>();
  const [customProvider, setCustomProvider] = useState<AiCustomProviderStatus>();
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [savingCustomProvider, setSavingCustomProvider] = useState(false);
  const [modelFilter, setModelFilter] = useState<"all" | "installed" | "available">("all");
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
        setCustomModel(status.model ?? "deepseek-flash");
      })
      .catch(() => {
        if (!active) return;
        pushToast({
          tone: "danger",
          title: "自定义 API 配置无法读取",
          description: "原配置文件已保留，请检查系统加密存储或磁盘权限。",
        });
      });
    return () => {
      active = false;
    };
  }, [isActive, pushToast]);

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
    } catch (error) {
      const existingConfigUnreadable =
        /custom_ai_config_(?:invalid|unreadable)|custom_ai_encryption_unavailable|EACCES|EISDIR/u.test(
          String(error),
        );
      pushToast({
        tone: "danger",
        title: "自定义 API 保存失败",
        description: existingConfigUnreadable
          ? "原配置无法读取，已保留原文件。请检查系统加密存储或磁盘权限。"
          : "请检查 API 地址、模型名称和密钥是否填写正确，然后重试。",
      });
    } finally {
      setSavingCustomProvider(false);
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
  const organizerReady =
    settings.aiOrganizerProvider === "custom" ? Boolean(customProvider?.configured) : true;
  const showCustomProvider = settings.aiOrganizerProvider === "custom";
  const installedAsrCount = asrModels.filter((model) => model.activeRevision).length;

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

  const providerSelect = (value: AiTextProvider, ariaLabel: string) => (
    <select
      className="ai-processing-select"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) =>
        void onChange({
          aiOrganizerProvider: event.target.value as AiTextProvider,
          aiRoomAskProvider: event.target.value as AiTextProvider,
        })
      }
    >
      <option value="cloud">房间云端（默认）</option>
      <option value="custom">自定义 API</option>
    </select>
  );

  const renderModel = (model: AiModelStatus) => {
    const selectable = model.category === "asr";
    const selected = model.id === settings.aiAsrModel;
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
          : "正在自动准备"
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
            <strong>{selectedAsr?.name ?? "未选择"}</strong>
          </article>
          <article>
            <small>录音整理</small>
            <strong>
              {settings.aiOrganizerProvider === "custom" ? "自定义 API" : "房间云端 AI"}
            </strong>
          </article>
          <article>
            <small>房间问答</small>
            <strong>
              {settings.aiOrganizerProvider === "custom" ? "自定义 API" : "房间云端 AI"}
            </strong>
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
          <SettingsItemRow
            label="自动整理"
            description={organizerReady ? undefined : "请先保存自定义 API。"}
          >
            <Switch
              isChecked={settings.isAiAutoOrganizeEnabled}
              isDisabled={!organizerReady || !selectedAsrReady}
              ariaLabel="自动整理"
              onChange={(checked) => void onChange({ isAiAutoOrganizeEnabled: checked })}
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="整理后自动上传"
            description="完成后分享摘要到录音所属房间，用于每日总结；需进入对应房间。"
          >
            <Switch
              isChecked={settings.isAiAutoUploadEnabled === true}
              ariaLabel="整理后自动上传"
              onChange={(checked) => void onChange({ isAiAutoUploadEnabled: checked })}
            />
          </SettingsItemRow>
        </div>
      </section>
      <section
        ref={modelManagementRef}
        id="ai-model-management"
        className="ai-model-group mt-3 scroll-mt-4"
        aria-labelledby="model-management-title"
      >
        <div className="ai-model-group-heading">
          <h3 id="model-management-title">模型</h3>
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
        </div>
        <div className="mt-3 space-y-3">
          <SettingsItemRow
            label="整理与问答模型"
            description="整理会将文字稿发送至所选服务；上传只分享整理摘要到房间。"
          >
            {providerSelect(settings.aiOrganizerProvider, "整理与问答模型")}
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
        </div>
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
