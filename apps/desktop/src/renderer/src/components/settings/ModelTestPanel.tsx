import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CheckCircle2,
  CircleStop,
  Download,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";

import {
  AI_ASR_MODEL_NAMES,
  buildReadableTranscriptParagraphs,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
  type VoiceMemoryBenchmarkMode,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { LiquidSelectionIndicator } from "../motion/LiquidSelectionIndicator";
import {
  DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE,
  isSelectableModelComparisonModel,
  modelComparisonQueue,
  type ModelComparisonJobSnapshot,
} from "../../features/ai/modelComparisonQueue";
import {
  buildModelComparisonExport,
  buildModelComparisonSummaryExport,
  downloadModelComparisonExport,
} from "../../features/ai/modelComparisonExport";
import {
  areVoiceMemoryStatsComplete,
  isVoiceMemoryTranscriptionComplete,
  voiceMemoryStatsPercent,
} from "../../features/ai/voiceMemoryPresentation";

interface ModelTestPanelProps {
  recording: RecordingLibraryItem;
  recordingTitle: string;
  audioDurationMs?: number;
  onClose: () => void;
  onSeek: (offsetMs: number) => void;
}

const benchmarkScopeDuration = (
  mode: VoiceMemoryBenchmarkMode | undefined,
  sourceDurationMs: number | undefined,
): number | undefined => {
  if (!sourceDurationMs || sourceDurationMs <= 0) return undefined;
  if (mode === "smoke") return Math.min(sourceDurationMs, 3 * 60_000);
  if (mode === "standard") return Math.min(sourceDurationMs, 10 * 60_000);
  return sourceDurationMs;
};

const formatClock = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
};

const modelDisplayName = (id: AiAsrModelId | string): string =>
  AI_ASR_MODEL_NAMES[id as AiAsrModelId] ?? id;

const isKnownAsrModelId = (value: string): value is AiAsrModelId =>
  Object.prototype.hasOwnProperty.call(AI_ASR_MODEL_NAMES, value);

const modelSelectionStorageKey = (recordingId: string): string =>
  `shanghao.recording-model-comparison.${recordingId}`;

const readStoredModelSelection = (recordingId: string): AiAsrModelId[] | undefined => {
  try {
    const raw = window.localStorage.getItem(modelSelectionStorageKey(recordingId));
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isKnownAsrModelId) : [];
  } catch {
    return undefined;
  }
};

/** Compares several installed ASR models on one recording and keeps every result locally. */
export const ModelTestPanel = ({
  recording,
  recordingTitle,
  audioDurationMs,
  onClose,
  onSeek,
}: ModelTestPanelProps) => {
  const [models, setModels] = useState<AiModelStatus[]>([]);
  const [record, setRecord] = useState<VoiceMemoryRecord>();
  const [job, setJob] = useState<ModelComparisonJobSnapshot | undefined>(() =>
    modelComparisonQueue.get(recording.recordingId),
  );
  const [selectedModelIds, setSelectedModelIds] = useState<Set<AiAsrModelId>>(
    () => new Set(readStoredModelSelection(recording.recordingId) ?? []),
  );
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const selectionHydratedRef = useRef(false);
  const [viewingModelId, setViewingModelId] = useState<AiAsrModelId>();
  const [isSwitchingResult, setIsSwitchingResult] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearingResults, setIsClearingResults] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSelectionOpen, setIsSelectionOpen] = useState(false);
  const [benchmarkMode, setBenchmarkMode] = useState<VoiceMemoryBenchmarkMode>(
    () => job?.benchmarkMode ?? DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE,
  );
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setModels([]);
    setRecord(undefined);
    const restoredJob = modelComparisonQueue.get(recording.recordingId);
    setJob(restoredJob);
    setBenchmarkMode(restoredJob?.benchmarkMode ?? DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE);
    setError(undefined);
    setViewingModelId(undefined);
    selectionHydratedRef.current = false;

    const unsubscribeJob = modelComparisonQueue.subscribe(recording.recordingId, setJob);

    void (async () => {
      const [snapshotResult, recordResult] = await Promise.allSettled([
        window.desktopApi.ai.getSnapshot(),
        window.desktopApi.ai.getVoiceMemory(recording.recordingId),
      ]);
      if (!active) return;

      const installed =
        snapshotResult.status === "fulfilled"
          ? snapshotResult.value.models.filter(isSelectableModelComparisonModel)
          : [];
      const savedRecord = recordResult.status === "fulfilled" ? recordResult.value : undefined;

      if (snapshotResult.status === "fulfilled") setModels(installed);
      else setError("无法读取已安装模型，请重新打开此页面。");

      if (recordResult.status === "fulfilled") {
        setRecord(savedRecord);
        setViewingModelId(savedRecord?.transcriptionModel?.id);
      } else {
        setError((current) => current ?? "无法读取这条录音的转录结果，但仍可重新开始测试。");
      }

      if (snapshotResult.status === "fulfilled") {
        const currentModel = savedRecord?.transcriptionModel?.id;
        const storedSelection = readStoredModelSelection(recording.recordingId);
        const installedIds = new Set(installed.map((model) => model.id));
        if (storedSelection !== undefined) {
          setSelectedModelIds(
            new Set(storedSelection.filter((modelId) => installedIds.has(modelId))),
          );
        } else {
          const savedModelIds = Object.keys(savedRecord?.transcriptionVariants ?? {}).filter(
            isKnownAsrModelId,
          );
          if (currentModel && isKnownAsrModelId(currentModel)) savedModelIds.push(currentModel);
          setSelectedModelIds(
            new Set(savedModelIds.filter((modelId) => installedIds.has(modelId))),
          );
        }
        selectionHydratedRef.current = true;

        if (
          restoredJob?.recovered &&
          restoredJob.phase === "paused" &&
          savedRecord?.taskStatus === "processing" &&
          installed.length > 0
        ) {
          // A renderer reload does not stop the main-process transcription. Reattach immediately
          // so the user sees live progress and the remaining models continue without another click.
          modelComparisonQueue.resume(recordingRef.current, installed);
        }
      }
    })();

    const unsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((next) => {
      if (!active || next.recordingId !== recording.recordingId) return;
      const settled =
        next.taskStatus !== "processing" &&
        (next.phase === "ready" || next.phase === "error" || next.phase === "paused");
      setRecord((current) => {
        // A long recording can contain thousands of transcript segments. While a model is
        // running, keep the existing snapshot and only update the small progress fields so
        // the comparison page does not repeatedly clone the whole transcript in React.
        if (!current || settled) return next;
        return {
          ...current,
          phase: next.phase,
          progress: next.progress,
          taskId: next.taskId,
          taskStatus: next.taskStatus,
          processingStage: next.processingStage,
          diagnostic: next.diagnostic,
          errorMessage: next.errorMessage,
        };
      });
      if (next.transcriptionModel?.id) setViewingModelId(next.transcriptionModel.id);
    });
    return () => {
      active = false;
      unsubscribe();
      unsubscribeJob();
    };
  }, [recording.recordingId]);

  useEffect(() => {
    if (!selectionHydratedRef.current) return;
    try {
      window.localStorage.setItem(
        modelSelectionStorageKey(recording.recordingId),
        JSON.stringify([...selectedModelIds]),
      );
    } catch {
      // Local selection is a convenience; completed results remain in the recording record.
    }
  }, [recording.recordingId, selectedModelIds]);

  useEffect(() => {
    if (!isSelectionOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSelectionOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSelectionOpen]);

  const phase = job?.phase ?? "idle";
  const currentIndex = job?.currentIndex ?? -1;
  const currentProgress = Math.max(0, Math.min(1, job?.currentProgress ?? 0));
  const activeBenchmarkMode = job?.benchmarkMode ?? benchmarkMode;
  const activeScopeDurationMs = benchmarkScopeDuration(activeBenchmarkMode, audioDurationMs);
  const wholeRecordingProgress =
    audioDurationMs && activeScopeDurationMs && activeScopeDurationMs < audioDurationMs
      ? (activeScopeDurationMs / audioDurationMs) * currentProgress
      : currentProgress;
  const runModelIds = job?.modelIds ?? [];
  const results = useMemo(() => job?.results ?? {}, [job?.results]);
  const selectedModels = useMemo(
    () => models.filter((model) => selectedModelIds.has(model.id as AiAsrModelId)),
    [models, selectedModelIds],
  );
  const displayParagraphs = useMemo(
    () => buildReadableTranscriptParagraphs(record?.transcript ?? []),
    [record?.transcript],
  );
  const speakerShareItems = useMemo(() => {
    const speakers = new Map<string, { name: string; durationMs: number }>();
    for (const segment of record?.transcript ?? []) {
      const speakerId = segment.speakerId || "unknown";
      const known = record?.speakers.find((speaker) => speaker.speakerId === speakerId);
      const current = speakers.get(speakerId) ?? {
        name:
          segment.nickname ??
          segment.displayNameSnapshot ??
          known?.nickname ??
          known?.displayNameSnapshot ??
          speakerId,
        durationMs: 0,
      };
      current.durationMs += Math.max(1, segment.endMs - segment.startMs);
      speakers.set(speakerId, current);
    }
    const totalMs = [...speakers.values()].reduce((sum, speaker) => sum + speaker.durationMs, 0);
    return [...speakers.entries()]
      .map(([speakerId, speaker]) => ({
        speakerId,
        ...speaker,
        sharePercent: totalMs > 0 ? (speaker.durationMs / totalMs) * 100 : 0,
      }))
      .sort((left, right) => right.durationMs - left.durationMs);
  }, [record?.speakers, record?.transcript]);
  const savedModelIds = useMemo(() => {
    const saved = new Set<AiAsrModelId>(
      Object.keys(record?.transcriptionVariants ?? {}).filter(isKnownAsrModelId),
    );
    if (
      record?.transcriptionModel &&
      record.transcript.length &&
      isKnownAsrModelId(record.transcriptionModel.id)
    )
      saved.add(record.transcriptionModel.id);
    return [...saved];
  }, [record]);
  const comparisonModelIds = useMemo(() => {
    const relevantModelIds = [
      ...new Set([
        ...selectedModels.map((model) => model.id as AiAsrModelId),
        ...savedModelIds,
        ...Object.keys(results).filter(isKnownAsrModelId),
      ]),
    ];
    // Clearing benchmark results must not make the installed model pool disappear. Older
    // recordings may not have a persisted picker selection, so show every installed model as
    // pending until the user opens the picker and chooses a narrower set.
    const visibleModelIds = relevantModelIds.length
      ? relevantModelIds
      : models.map((model) => model.id as AiAsrModelId);
    return visibleModelIds.sort((left, right) =>
      modelDisplayName(left).localeCompare(modelDisplayName(right)),
    );
  }, [models, results, savedModelIds, selectedModels]);
  const canExportResults = comparisonModelIds.some(
    (modelId) =>
      results[modelId] ||
      record?.transcriptionVariants?.[modelId] ||
      (record?.transcriptionModel?.id === modelId && record.transcript.length),
  );

  const refreshSelectableModels = async (): Promise<AiModelStatus[]> => {
    const snapshot = await window.desktopApi.ai.getSnapshot();
    const installed = snapshot.models.filter(isSelectableModelComparisonModel);
    setModels(installed);
    return installed;
  };

  const openSelection = async () => {
    setError(undefined);
    setIsSelectionOpen(true);
    setIsLoadingModels(true);
    try {
      const installed = await refreshSelectableModels();
      if (!installed.length) setError("没有检测到已安装的转录模型，请先在 AI 功能中安装模型。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取已安装模型失败，请重试。");
    } finally {
      setIsLoadingModels(false);
    }
  };

  const start = () => {
    if (!selectedModels.length) return;
    setError(undefined);
    setIsSelectionOpen(false);
    modelComparisonQueue.start(recording, selectedModels, benchmarkMode);
  };

  const resume = async () => {
    setError(undefined);
    try {
      const availableModels = models.length ? models : await refreshSelectableModels();
      if (!availableModels.length) {
        setError("没有检测到已安装的转录模型，请先在 AI 功能中安装模型。");
        return;
      }
      modelComparisonQueue.resume(recording, availableModels);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取已安装模型失败，请重试。");
    }
  };

  const pause = async () => {
    if (phase !== "running") return;
    await modelComparisonQueue.pause(recording.recordingId);
  };

  const stop = async () => {
    if (phase !== "running") return;
    await modelComparisonQueue.stop(recording.recordingId);
  };

  const clearResults = async () => {
    if (phase === "running" || isClearingResults) return;
    const confirmed = window.confirm(
      "清除这条录音的全部模型测试结果和进度？录音文件和快捷标记会保留。",
    );
    if (!confirmed) return;
    const installedModelIds = new Set(models.map((model) => model.id as AiAsrModelId));
    const selectionToKeep = new Set(
      [...selectedModelIds, ...runModelIds, ...savedModelIds].filter((modelId) =>
        installedModelIds.has(modelId),
      ),
    );
    setIsClearingResults(true);
    setError(undefined);
    try {
      const cleared = await modelComparisonQueue.clear(recording.recordingId);
      setRecord(cleared);
      setViewingModelId(undefined);
      setSelectedModelIds(
        selectionToKeep.size
          ? selectionToKeep
          : new Set(models.map((model) => model.id as AiAsrModelId)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清除测试结果失败，请重试。");
    } finally {
      setIsClearingResults(false);
    }
  };

  const close = () => onClose();

  const selectResult = async (modelId: AiAsrModelId) => {
    const alreadyActive =
      record?.transcriptionModel?.id === modelId && Boolean(record.transcript.length);
    if (phase === "running" || (!alreadyActive && !record?.transcriptionVariants?.[modelId]))
      return;
    if (alreadyActive) {
      setViewingModelId(modelId);
      return;
    }
    setIsSwitchingResult(true);
    setError(undefined);
    try {
      const next = await window.desktopApi.ai.selectTranscription(recording.recordingId, modelId);
      setRecord(next);
      setViewingModelId(modelId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "切换对比结果失败");
    } finally {
      setIsSwitchingResult(false);
    }
  };

  const toggleModel = (modelId: AiAsrModelId) => {
    setSelectedModelIds((current) => {
      const next = new Set(current);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const exportResults = async () => {
    if (isExporting || !canExportResults) return;
    setIsExporting(true);
    setError(undefined);
    try {
      const runtimeInfo = await window.desktopApi.app.getRuntimeInfo();
      const payload = buildModelComparisonExport({
        recording,
        recordingTitle,
        audioDurationMs,
        record,
        modelIds: comparisonModelIds,
        results,
        models,
        environment: {
          appVersion: runtimeInfo.version,
          gitCommit: import.meta.env.VITE_GIT_COMMIT ?? "unknown",
        },
      });
      const safeTitle = recordingTitle.replace(/[<>:"/\\|?*]/g, "_").trim() || "录音";
      downloadModelComparisonExport(payload, `上号-模型对比-${safeTitle}.json`);
      window.setTimeout(
        () =>
          downloadModelComparisonExport(
            buildModelComparisonSummaryExport(payload),
            `上号-模型对比-${safeTitle}-comparison-summary.json`,
          ),
        80,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出模型对比数据失败");
    } finally {
      setIsExporting(false);
    }
  };

  const currentModel =
    currentIndex >= 0
      ? runModelIds
          .slice(currentIndex, currentIndex + 1)
          .map((modelId) => models.find((model) => model.id === modelId))[0]
      : undefined;
  const quickItems = (record?.timeline ?? []).slice(0, 8);
  const currentPhaseLabel: Record<string, string> = {
    waiting: "等待运行",
    loading: "加载模型",
    transcribing: "转录中",
    paused: "已暂停",
    releasing: "释放运行时",
    stuck: "可能无响应",
    success: "已完成",
    partial: "部分完成",
    failed: "失败",
    "user-stopped": "已停止",
  };

  return (
    <section className="model-comparison-panel" aria-label="录音模型对比">
      <div className="model-comparison-results">
        <div className="model-comparison-section-head">
          <div>
            <h4>转录结果</h4>
          </div>
          <div className="model-comparison-result-actions">
            <Button
              variant="secondary"
              disabled={!canExportResults || isExporting}
              onClick={exportResults}
            >
              <Download aria-hidden="true" />
              {isExporting ? "准备导出…" : "导出测试数据"}
            </Button>
            <button type="button" className="model-comparison-close" onClick={() => void close()}>
              <X aria-hidden="true" /> 返回录音
            </button>
            {isSwitchingResult ? (
              <LoaderCircle className="model-comparison-spinner" aria-label="正在切换结果" />
            ) : null}
          </div>
        </div>
        <div className="model-comparison-actions model-comparison-toolbar">
          {phase === "running" ? (
            <>
              <Button variant="secondary" onClick={() => void pause()}>
                <Pause aria-hidden="true" /> 暂停
              </Button>
              <Button variant="ghost" onClick={() => void stop()}>
                <CircleStop aria-hidden="true" /> 停止
              </Button>
            </>
          ) : phase === "paused" || phase === "stopped" ? (
            <Button onClick={() => void resume()}>
              <Play aria-hidden="true" /> 继续未完成测试
            </Button>
          ) : (
            <Button
              disabled={isLoadingModels}
              title="点击开始测试，选择对比模型"
              onClick={() => void openSelection()}
            >
              {isLoadingModels ? (
                <LoaderCircle className="model-comparison-spinner" aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}{" "}
              {phase === "complete" ? "重新开始测试" : "开始测试"}
            </Button>
          )}
          {phase !== "idle" || savedModelIds.length > 0 ? (
            <Button
              variant="ghost"
              disabled={phase === "running" || isClearingResults}
              onClick={() => void clearResults()}
            >
              {isClearingResults ? (
                <LoaderCircle className="model-comparison-spinner" aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}{" "}
              清除测试结果
            </Button>
          ) : null}
          {phase !== "idle" ? (
            <span className="model-comparison-run-status" aria-live="polite">
              {phase === "running" && currentModel
                ? `${modelDisplayName(currentModel.id as AiAsrModelId)} · ${currentPhaseLabel[job?.currentPhase ?? "waiting"] ?? "处理中"} ${Math.round(currentProgress * 100)}%${wholeRecordingProgress < currentProgress ? `（整段 ${Math.max(0.1, wholeRecordingProgress * 100).toFixed(1)}%）` : ""} · 第 ${currentIndex + 1}/${runModelIds.length} 个`
                : phase === "complete"
                  ? "本轮测试已完成，结果已保存在本机。"
                  : phase === "paused"
                    ? job?.recovered
                      ? "检测到上次应用中断，可继续当前模型。"
                      : "已暂停，可继续当前模型。"
                    : phase === "stopped"
                      ? "已停止，已完成结果保留，可继续剩余模型。"
                      : ""}
            </span>
          ) : null}
        </div>
        {phase === "running" ? (
          <div
            className="model-comparison-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(currentProgress * 100)}
            aria-label={
              currentModel ? `${modelDisplayName(currentModel.id)}转录进度` : "模型转录进度"
            }
          >
            <span style={{ transform: `scaleX(${currentProgress})` }} />
          </div>
        ) : null}
        {(error ?? job?.error) ? (
          <p className="model-comparison-error" role="alert">
            {error ?? job?.error}
          </p>
        ) : null}
        {comparisonModelIds.length ? (
          <div
            className="model-comparison-result-tabs"
            role="tablist"
            aria-label="选择模型转录结果"
          >
            {comparisonModelIds.map((modelId) => {
              const batchResult = results[modelId];
              const saved = Boolean(record?.transcriptionVariants?.[modelId]);
              const alreadyActive =
                record?.transcriptionModel?.id === modelId && Boolean(record.transcript.length);
              const available = saved || alreadyActive;
              const active = viewingModelId === modelId;
              const variant = record?.transcriptionVariants?.[modelId];
              const variantPercent = voiceMemoryStatsPercent(variant?.transcriptionStats);
              const activePercent = voiceMemoryStatsPercent(record?.transcriptionStats);
              const variantComplete = variant?.transcriptionStats
                ? areVoiceMemoryStatsComplete(variant.transcriptionStats)
                : Boolean(variant?.transcript.length);
              const activeComplete = record ? isVoiceMemoryTranscriptionComplete(record) : false;
              const detailStats = saved
                ? variant?.transcriptionStats
                : alreadyActive
                  ? record?.transcriptionStats
                  : undefined;
              const durableComplete = saved
                ? variantComplete
                : alreadyActive
                  ? activeComplete
                  : batchResult?.status === "success";
              const batchStatus =
                batchResult?.status === "success" && !durableComplete
                  ? "partial"
                  : batchResult?.status;
              const label = batchResult
                ? batchStatus === "success"
                  ? "任务完成 100%"
                  : batchStatus === "partial"
                    ? `任务完成 ${Math.round(variantPercent ?? activePercent ?? batchResult.taskProgressPercent ?? 0)}%`
                    : batchStatus === "paused"
                      ? `已暂停 · ${Math.round(variantPercent ?? activePercent ?? batchResult.taskProgressPercent ?? currentProgress * 100)}%`
                      : batchStatus === "user-stopped"
                        ? `已停止 · ${Math.round(variantPercent ?? activePercent ?? batchResult.taskProgressPercent ?? currentProgress * 100)}%`
                        : "失败"
                : saved
                  ? variantComplete
                    ? "任务完成 100%"
                    : `任务完成 ${variantPercent ?? 0}%`
                  : alreadyActive
                    ? activeComplete
                      ? "任务完成 100%"
                      : `任务完成 ${activePercent ?? 0}%`
                    : "待测试";
              const detailTaskPercent =
                detailStats?.taskProgressPercent ??
                (detailStats?.totalUnits
                  ? ((detailStats.completedUnits + detailStats.failedUnits) /
                      detailStats.totalUnits) *
                    100
                  : undefined);
              const detailTitle = detailStats
                ? [
                    `任务完成 ${(detailTaskPercent ?? 0).toFixed(1)}%`,
                    `有效语音处理 ${(
                      detailStats.processedSpeechPercent ??
                      (detailTaskPercent === 100 && detailStats.failedUnits === 0
                        ? 100
                        : (detailStats.processedPercent ?? 0))
                    ).toFixed(1)}%`,
                    `音频语音占比 ${(
                      detailStats.speechRatioPercent ??
                      detailStats.processedPercent ??
                      0
                    ).toFixed(1)}%`,
                    `识别覆盖率 ${(detailStats.speechCoveragePercent ?? 0).toFixed(1)}%`,
                  ].join("；")
                : (batchResult?.message ??
                  (!available ? "该模型尚未产生可查看的转录结果；重新测试后可查看。" : undefined));
              return (
                <button
                  key={modelId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`model-comparison-result-tab ${active ? "is-active" : ""} ${batchStatus === "failed" ? "is-failed" : ""} ${batchStatus === "partial" ? "is-partial" : ""}`}
                  disabled={!available || phase === "running" || isSwitchingResult}
                  title={detailTitle}
                  onClick={() => void selectResult(modelId)}
                >
                  {active ? <LiquidSelectionIndicator layoutId="model-result-selection" /> : null}
                  <span className="relative z-[1]">{modelDisplayName(modelId)}</span>
                  <small className="relative z-[1]">{label}</small>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="model-comparison-content" role="tabpanel">
        <section className="model-comparison-summary-block">
          <div className="model-comparison-content-heading">
            <h4>快捷</h4>
          </div>
          {quickItems.length ? (
            <div className="model-comparison-timeline">
              {quickItems.map((item) => (
                <button key={item.id} type="button" onClick={() => onSeek(item.offsetMs)}>
                  <time>{formatClock(item.offsetMs)}</time>
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="model-comparison-empty">在上方播放时间轴添加标记后，可在这里快捷跳转。</p>
          )}
        </section>
        <section className="model-comparison-summary-block">
          <div className="model-comparison-content-heading">
            <h4>说话人</h4>
            <span>{speakerShareItems.length} 位</span>
          </div>
          {speakerShareItems.length ? (
            <div className="model-comparison-speakers">
              {speakerShareItems.map((speaker) => (
                <span
                  key={speaker.speakerId}
                  title={`${speaker.name} 说话约 ${(speaker.durationMs / 60_000).toFixed(1)} 分钟`}
                >
                  <CheckCircle2 aria-hidden="true" />
                  {speaker.name} {speaker.sharePercent.toFixed(1)}%
                </span>
              ))}
            </div>
          ) : (
            <p className="model-comparison-empty">暂无说话人</p>
          )}
        </section>
        <section className="model-comparison-transcript-block">
          <div className="model-comparison-content-heading">
            <h4>转文字</h4>
          </div>
          {displayParagraphs.length ? (
            <div className="model-comparison-transcript">
              {displayParagraphs.map((paragraph) => (
                <button key={paragraph.id} type="button" onClick={() => onSeek(paragraph.startMs)}>
                  <time>{formatClock(paragraph.startMs)}</time>
                  <strong>{paragraph.nickname ?? paragraph.speakerId ?? "说话人"}</strong>
                  <span>{paragraph.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="model-comparison-empty">请选择一个已完成的结果。</p>
          )}
        </section>
      </div>
      {isSelectionOpen
        ? createPortal(
            <div
              className="model-comparison-picker-backdrop modal-scrim"
              role="presentation"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) setIsSelectionOpen(false);
              }}
            >
              <section
                className="model-comparison-picker modal-surface"
                role="dialog"
                aria-modal="true"
                aria-labelledby="model-comparison-picker-title"
              >
                <div className="model-comparison-picker-heading">
                  <div>
                    <h2 id="model-comparison-picker-title">选择测试模型</h2>
                    <p>模型会按顺序逐个转录；中断后可从已保存的真实进度继续。</p>
                  </div>
                  <button
                    type="button"
                    className="model-comparison-picker-close"
                    aria-label="关闭模型选择"
                    onClick={() => setIsSelectionOpen(false)}
                  >
                    <X aria-hidden="true" />
                  </button>
                </div>
                <div className="model-comparison-mode" role="group" aria-label="测试类型">
                  {(
                    [
                      ["long", "完整录音", "默认测试整段音频，保留暂停和断点续转"],
                      ["standard", "十分钟样本", "抽取录音中间 10 分钟，保留真实原始位置"],
                      ["smoke", "快速检查", "只测试前 3 分钟，验证加载与明显异常"],
                    ] as const
                  ).map(([mode, title, description]) => (
                    <button
                      key={mode}
                      type="button"
                      className={benchmarkMode === mode ? "is-active" : ""}
                      aria-pressed={benchmarkMode === mode}
                      onClick={() => setBenchmarkMode(mode)}
                    >
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </button>
                  ))}
                </div>
                <div
                  className="model-comparison-picker-grid"
                  role="group"
                  aria-label="选择测试模型"
                >
                  {models.length ? (
                    models.map((model) => {
                      const modelId = model.id as AiAsrModelId;
                      const selected = selectedModelIds.has(modelId);
                      const saved = Boolean(
                        record?.transcriptionVariants?.[modelId] ||
                        (record?.transcriptionModel?.id === modelId && record.transcript.length),
                      );
                      return (
                        <button
                          key={model.id}
                          type="button"
                          className={`model-comparison-model ${selected ? "is-selected" : ""}`}
                          aria-pressed={selected}
                          onClick={() => toggleModel(modelId)}
                        >
                          <span className="model-comparison-checkbox">
                            {selected ? <Check aria-hidden="true" /> : null}
                          </span>
                          <span>
                            <strong>{modelDisplayName(modelId)}</strong>
                            <small>{saved ? "已有结果，选中后重新测试" : "尚未测试"}</small>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="model-comparison-empty">
                      还没有可运行的模型，请先在 AI 功能中安装模型。
                    </p>
                  )}
                </div>
                <div className="model-comparison-picker-actions">
                  <strong>已选 {selectedModels.length} 个</strong>
                  <Button variant="secondary" onClick={() => setIsSelectionOpen(false)}>
                    取消
                  </Button>
                  <Button disabled={!selectedModels.length} onClick={start}>
                    <Play aria-hidden="true" /> 开始测试
                  </Button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
};
