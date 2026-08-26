import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  CircleStop,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";

import {
  AI_ASR_MODEL_NAMES,
  mergeTranscriptIntoSentences,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { LiquidSelectionIndicator } from "../motion/LiquidSelectionIndicator";
import {
  modelComparisonQueue,
  type ModelComparisonJobSnapshot,
} from "../../features/ai/modelComparisonQueue";

interface ModelTestPanelProps {
  recording: RecordingLibraryItem;
  recordingTitle: string;
  onClose: () => void;
  onSeek: (offsetMs: number) => void;
}

const formatElapsed = (milliseconds: number | undefined): string =>
  milliseconds === undefined ? "--" : `${(milliseconds / 1_000).toFixed(1)} 秒`;

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
  const selectionHydratedRef = useRef(false);
  const [viewingModelId, setViewingModelId] = useState<AiAsrModelId>();
  const [isSwitchingResult, setIsSwitchingResult] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setRecord(undefined);
    setJob(modelComparisonQueue.get(recording.recordingId));
    setError(undefined);
    setViewingModelId(undefined);

    const unsubscribeJob = modelComparisonQueue.subscribe(recording.recordingId, setJob);

    void Promise.all([
      window.desktopApi.ai.getSnapshot(),
      window.desktopApi.ai.getVoiceMemory(recording.recordingId),
    ])
      .then(([snapshot, savedRecord]) => {
        if (!active) return;
        const installed = snapshot.models.filter(
          (model): model is AiModelStatus =>
            model.category === "asr" && Boolean(model.activeRevision && model.runtimeReady),
        );
        setModels(installed);
        setRecord(savedRecord);
        const currentModel = savedRecord?.transcriptionModel?.id;
        setViewingModelId(currentModel);
        const storedSelection = readStoredModelSelection(recording.recordingId);
        if (storedSelection !== undefined) {
          const installedIds = new Set(installed.map((model) => model.id));
          setSelectedModelIds(
            new Set(storedSelection.filter((modelId) => installedIds.has(modelId))),
          );
        } else {
          const savedModelIds = Object.keys(savedRecord?.transcriptionVariants ?? {}).filter(
            isKnownAsrModelId,
          );
          if (currentModel && isKnownAsrModelId(currentModel)) savedModelIds.push(currentModel);
          const installedIds = new Set(installed.map((model) => model.id));
          setSelectedModelIds(
            new Set(savedModelIds.filter((modelId) => installedIds.has(modelId))),
          );
        }
        selectionHydratedRef.current = true;
      })
      .catch(() => setError("无法读取可测试模型，请先刷新 AI 功能。"));

    const unsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((next) => {
      if (!active || next.recordingId !== recording.recordingId) return;
      setRecord(next);
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

  const phase = job?.phase ?? "idle";
  const currentIndex = job?.currentIndex ?? -1;
  const runModelIds = job?.modelIds ?? [];
  const results = job?.results ?? {};
  const selectedModels = useMemo(
    () => models.filter((model) => selectedModelIds.has(model.id as AiAsrModelId)),
    [models, selectedModelIds],
  );
  const readableTranscript = useMemo(
    () => mergeTranscriptIntoSentences(record?.transcript ?? []),
    [record?.transcript],
  );
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
  const comparisonModelIds = useMemo(
    () =>
      [
        ...new Set([...selectedModels.map((model) => model.id as AiAsrModelId), ...savedModelIds]),
      ].sort((left, right) => modelDisplayName(left).localeCompare(modelDisplayName(right))),
    [savedModelIds, selectedModels],
  );

  const start = () => {
    setError(undefined);
    modelComparisonQueue.start(recording, selectedModels);
  };

  const resume = () => {
    setError(undefined);
    modelComparisonQueue.resume(recording, models);
  };

  const rerunModel = (modelId: AiAsrModelId) => {
    const model = models.find((candidate) => candidate.id === modelId);
    if (!model || phase === "running" || phase === "paused") return;
    setError(undefined);
    modelComparisonQueue.rerun(recording, model);
  };

  const pause = async () => {
    if (phase !== "running") return;
    await modelComparisonQueue.pause(recording.recordingId);
  };

  const stop = async () => {
    if (phase !== "running") return;
    await modelComparisonQueue.stop(recording.recordingId);
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

  const currentModel =
    currentIndex >= 0
      ? runModelIds
          .slice(currentIndex, currentIndex + 1)
          .map((modelId) => models.find((model) => model.id === modelId))[0]
      : undefined;
  const quickItems = (record?.timeline ?? []).slice(0, 8);

  return (
    <section className="model-comparison-panel" aria-label="录音模型对比">
      <header className="model-comparison-header">
        <div>
          <span className="model-comparison-kicker">同一条录音 · 多模型转录</span>
          <h3>模型对比</h3>
          <p>{recordingTitle}</p>
        </div>
        <button type="button" className="model-comparison-close" onClick={() => void close()}>
          <X aria-hidden="true" /> 返回录音
        </button>
      </header>

      <div className="model-comparison-setup">
        <div className="model-comparison-section-head">
          <div>
            <h4>选择要对比的模型</h4>
            <p>测试时会一个接一个运行；每个完成的文字与耗时都会保存到这条录音。</p>
          </div>
          <strong>{selectedModels.length} 个已选</strong>
        </div>
        <div className="model-comparison-models" role="group" aria-label="选择对比模型">
          {models.length ? (
            models.map((model) => {
              const modelId = model.id as AiAsrModelId;
              const selected = selectedModelIds.has(modelId);
              const saved = Boolean(
                record?.transcriptionVariants?.[modelId] ||
                (record?.transcriptionModel?.id === modelId && record.transcript.length),
              );
              return (
                <div key={model.id} className="model-comparison-model-row">
                  <button
                    type="button"
                    className={`model-comparison-model ${selected ? "is-selected" : ""}`}
                    aria-pressed={selected}
                    disabled={phase === "running" || phase === "paused"}
                    onClick={() => toggleModel(modelId)}
                  >
                    <span className="model-comparison-checkbox">
                      {selected ? <Check aria-hidden="true" /> : null}
                    </span>
                    <span>
                      <strong>{modelDisplayName(modelId)}</strong>
                      <small>{saved ? "已有保存结果，可重新测试" : "尚未保存结果"}</small>
                    </span>
                  </button>
                  {saved ? (
                    <button
                      type="button"
                      className="model-comparison-rerun"
                      disabled={phase === "running" || phase === "paused"}
                      aria-label={`重新测试${modelDisplayName(modelId)}`}
                      onClick={() => rerunModel(modelId)}
                    >
                      重测
                    </button>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="model-comparison-empty">还没有可运行的模型，请先在 AI 功能中安装模型。</p>
          )}
        </div>
        <div className="model-comparison-actions">
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
            <Button onClick={resume}>
              <Play aria-hidden="true" /> 继续剩余测试
            </Button>
          ) : (
            <Button disabled={!selectedModels.length} onClick={start}>
              <Play aria-hidden="true" /> {phase === "complete" ? "重新开始测试" : "开始测试"}
            </Button>
          )}
          {phase !== "idle" ? (
            <Button
              variant="ghost"
              disabled={phase === "running"}
              onClick={() => {
                modelComparisonQueue.clear(recording.recordingId);
              }}
            >
              <RotateCcw aria-hidden="true" /> 清除本轮状态
            </Button>
          ) : null}
          <span className="model-comparison-run-status" aria-live="polite">
            {phase === "running" && currentModel
              ? `正在测试 ${currentIndex + 1}/${runModelIds.length} · ${modelDisplayName(currentModel.id as AiAsrModelId)}`
              : phase === "complete"
                ? "本轮测试已完成，结果已保存在本机。"
                : phase === "paused"
                  ? job?.recovered
                    ? "检测到上次应用中断，可继续当前模型。"
                    : "已暂停，可继续当前模型。"
                  : phase === "stopped"
                    ? "已停止，已完成结果保留，可继续剩余模型。"
                    : "选择模型后开始测试。"}
          </span>
        </div>
        {phase === "running" ? (
          <div
            className="model-comparison-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={runModelIds.length}
            aria-valuenow={Math.max(0, currentIndex)}
          >
            <span
              style={{
                transform: `scaleX(${runModelIds.length ? (currentIndex + 0.5) / runModelIds.length : 0})`,
              }}
            />
          </div>
        ) : null}
        {(error ?? job?.error) ? (
          <p className="model-comparison-error" role="alert">
            {error ?? job?.error}
          </p>
        ) : null}
      </div>

      <div className="model-comparison-results">
        <div className="model-comparison-section-head">
          <div>
            <h4>转录结果</h4>
            <p>点击一个已完成的模型，即可查看该模型保存的说话人和转文字。</p>
          </div>
          {isSwitchingResult ? (
            <LoaderCircle className="model-comparison-spinner" aria-label="正在切换结果" />
          ) : null}
        </div>
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
              const label = batchResult
                ? batchResult.status === "success"
                  ? formatElapsed(batchResult.elapsedMs)
                  : batchResult.status === "paused"
                    ? "已暂停"
                    : "失败"
                : saved
                  ? formatElapsed(record?.transcriptionVariants?.[modelId]?.transcriptionElapsedMs)
                  : alreadyActive
                    ? formatElapsed(record?.transcriptionElapsedMs)
                    : "待测试";
              return (
                <button
                  key={modelId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`model-comparison-result-tab ${active ? "is-active" : ""} ${batchResult?.status === "failed" ? "is-failed" : ""}`}
                  disabled={!available || phase === "running" || isSwitchingResult}
                  onClick={() => void selectResult(modelId)}
                >
                  {active ? <LiquidSelectionIndicator layoutId="model-result-selection" /> : null}
                  <span className="relative z-[1]">{modelDisplayName(modelId)}</span>
                  <small className="relative z-[1]">{label}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="model-comparison-empty">完成一次测试后，这里会保留每个模型的结果。</p>
        )}
      </div>

      <div className="model-comparison-content" role="tabpanel">
        <section>
          <div className="model-comparison-content-heading">
            <h4>快捷</h4>
            <span>沿用录音时间轴</span>
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
        <section>
          <div className="model-comparison-content-heading">
            <h4>说话人</h4>
            <span>{record?.speakers.length ?? 0} 位</span>
          </div>
          {record?.speakers.length ? (
            <div className="model-comparison-speakers">
              {record.speakers.map((speaker) => (
                <span key={speaker.speakerId}>
                  <CheckCircle2 aria-hidden="true" />
                  {speaker.nickname ?? speaker.displayNameSnapshot ?? speaker.speakerId}
                </span>
              ))}
            </div>
          ) : (
            <p className="model-comparison-empty">完成转录后，会在这里显示模型识别到的说话人。</p>
          )}
        </section>
        <section>
          <div className="model-comparison-content-heading">
            <h4>转文字</h4>
            <span>
              {viewingModelId ? modelDisplayName(viewingModelId) : "先选择一个保存的结果"}
            </span>
          </div>
          {readableTranscript.length ? (
            <div className="model-comparison-transcript">
              {readableTranscript.map((segment) => (
                <button key={segment.id} type="button" onClick={() => onSeek(segment.startMs)}>
                  <time>{formatClock(segment.startMs)}</time>
                  <strong>{segment.nickname ?? segment.speakerId ?? "说话人"}</strong>
                  <span>{segment.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="model-comparison-empty">
              选择一个完成的模型结果后，在这里逐段查看文字并跳转播放。
            </p>
          )}
        </section>
      </div>
    </section>
  );
};
