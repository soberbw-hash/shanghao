import type {
  VoiceMemoryBenchmarkDataValidity,
  VoiceMemoryBenchmarkRankingEligibility,
  VoiceMemoryBenchmarkResultStatus,
  VoiceMemoryTranscriptionStats,
  VoiceMemoryTranscriptionUnit,
} from "../types/ai.types";

export interface VoiceMemoryTranscriptionValidity {
  status: VoiceMemoryBenchmarkResultStatus;
  dataValidity: VoiceMemoryBenchmarkDataValidity;
  eligibleForQualityRanking: VoiceMemoryBenchmarkRankingEligibility;
  eligibleForSpeedRanking: VoiceMemoryBenchmarkRankingEligibility;
  eligibleForStabilityRanking: VoiceMemoryBenchmarkRankingEligibility;
  exclusionReasons: string[];
  recommendedAction: string;
  complete: boolean;
}

const countUnits = (
  units: readonly VoiceMemoryTranscriptionUnit[] | undefined,
  status: VoiceMemoryTranscriptionUnit["status"],
): number | undefined => units?.filter((unit) => unit.status === status).length;

export const evaluateVoiceMemoryTranscriptionValidity = (
  stats: VoiceMemoryTranscriptionStats | undefined,
  units?: readonly VoiceMemoryTranscriptionUnit[],
): VoiceMemoryTranscriptionValidity => {
  const totalUnits = stats?.totalUnits ?? units?.length ?? 0;
  const completedUnits = stats?.completedUnits ?? countUnits(units, "completed") ?? 0;
  const pendingUnits = stats?.pendingUnits ?? countUnits(units, "pending") ?? 0;
  const runningUnits = stats?.runningUnits ?? countUnits(units, "running") ?? 0;
  const failedUnits = stats?.failedUnits ?? countUnits(units, "failed") ?? 0;
  const processedAudioMs = stats?.processedAudioMs ?? 0;
  const audioDurationMs = stats?.audioDurationMs ?? 0;
  // Legacy persisted records predate this explicit bit; their presence in the store is itself
  // evidence of a save. New runs write false while active and true only in the terminal save.
  const finalResultSaved = Boolean(stats && stats.finalResultSaved !== false);
  const legacyAllUnitsCompleted =
    totalUnits > 0 &&
    completedUnits === totalUnits &&
    pendingUnits === 0 &&
    runningUnits === 0 &&
    failedUnits === 0;
  // Older speaker-aware records stored processed speech against clip duration but did not yet
  // persist scheduledSpeechMs. If every unit completed, processedAudioMs is the durable planned
  // work for that legacy run; do not mislabel its speech ratio as incomplete task progress.
  const scheduledSpeechMs =
    stats?.scheduledSpeechMs ?? (legacyAllUnitsCompleted ? processedAudioMs : audioDurationMs);
  const allScheduledSpeechProcessed =
    scheduledSpeechMs > 0 && processedAudioMs >= Math.max(1, scheduledSpeechMs - 10);
  const complete = Boolean(
    stats &&
    totalUnits > 0 &&
    completedUnits === totalUnits &&
    pendingUnits === 0 &&
    runningUnits === 0 &&
    failedUnits === 0 &&
    allScheduledSpeechProcessed &&
    finalResultSaved &&
    stats.terminationReason === "completed",
  );
  const started = completedUnits + runningUnits + failedUnits > 0 || processedAudioMs > 0;
  const statusConflict =
    stats?.terminationReason === "completed" &&
    (!complete || completedUnits !== totalUnits || pendingUnits > 0 || runningUnits > 0);
  const outputAnomaly =
    (stats?.repetitionLoopCount ?? 0) > 0 ||
    (stats?.abnormalOutputCount ?? 0) > 0 ||
    (stats?.emptyOutputOnSpeechUnits ?? 0) > 0;
  const runtimeError = failedUnits > 0 || stats?.terminationReason === "failed";
  const status: VoiceMemoryBenchmarkResultStatus = complete
    ? "success"
    : !started
      ? "not_started"
      : stats?.terminationReason === "paused"
        ? "paused"
        : stats?.terminationReason === "cancelled"
          ? "cancelled"
          : stats?.terminationReason === "stalled"
            ? "interrupted"
            : runtimeError
              ? "failed"
              : pendingUnits > 0 || runningUnits > 0
                ? "partial"
                : "incomplete";
  const dataValidity: VoiceMemoryBenchmarkDataValidity = !started
    ? "invalid_not_started"
    : statusConflict
      ? "invalid_status_conflict"
      : runtimeError
        ? "invalid_runtime_error"
        : outputAnomaly
          ? "invalid_output_anomaly"
          : complete
            ? "valid_complete"
            : "valid_partial";
  const exclusionReasons: string[] = [];
  if (!complete) exclusionReasons.push("任务未完整、可靠地处理并保存全部音频");
  if (failedUnits > 0) exclusionReasons.push(`${failedUnits} 个处理单元失败`);
  if (pendingUnits > 0) exclusionReasons.push(`${pendingUnits} 个处理单元未开始`);
  if (runningUnits > 0) exclusionReasons.push(`${runningUnits} 个处理单元仍在运行或被中断`);
  if (!allScheduledSpeechProcessed) exclusionReasons.push("实际成功处理音频未覆盖全部计划语音单元");
  if (!finalResultSaved) exclusionReasons.push("最终结果尚未确认持久化");
  if (outputAnomaly) exclusionReasons.push("存在重复循环或异常输出");
  const partialSpeedReference: VoiceMemoryBenchmarkRankingEligibility =
    processedAudioMs > 0 && !outputAnomaly ? "partial_reference" : false;
  return {
    status,
    dataValidity,
    eligibleForQualityRanking: complete && !outputAnomaly,
    eligibleForSpeedRanking: complete && !outputAnomaly ? true : partialSpeedReference,
    eligibleForStabilityRanking: complete,
    exclusionReasons,
    recommendedAction: complete
      ? outputAnomaly
        ? "复核异常片段后重测"
        : "结果完整，可参与对比"
      : runtimeError
        ? "修复运行时错误后从失败单元继续"
        : started
          ? "继续未完成的测试"
          : "启动该模型测试",
    complete,
  };
};
