import type { VoiceMemoryRecord, VoiceMemoryTranscriptionUnit } from "../types/ai.types";

export type TranscriptionReviewAction =
  "accept" | "retry_candidate" | "manual_review" | "incomplete";

export interface TranscriptionQualityDecision {
  action: TranscriptionReviewAction;
  reasonCodes: string[];
  sourceSpan: { memberId?: string; startMs: number; endMs: number };
  evidence: string[];
  retriesRemaining: number;
  autoRunAllowed: boolean;
}

export interface TranscriptionQualityEvidence {
  unit: VoiceMemoryTranscriptionUnit;
  sourceIdentityKnown?: boolean;
  alignmentValid?: boolean;
  sourceConflict?: boolean;
  retryLimit?: number;
}

/**
 * Deterministic triage only. VAD/activity is evidence for review, never proof that speech
 * was missed. Automatic retries share the unit's existing three-attempt budget.
 */
export function decideTranscriptionQuality({
  unit,
  sourceIdentityKnown = true,
  alignmentValid = true,
  sourceConflict = false,
  retryLimit = 3,
}: TranscriptionQualityEvidence): TranscriptionQualityDecision {
  const sourceSpan = {
    ...(unit.speakerId ? { memberId: unit.speakerId } : {}),
    startMs: unit.startMs,
    endMs: unit.endMs,
  };
  const retriesRemaining = Math.max(0, retryLimit - unit.attempts);
  const reasons: string[] = [];
  const evidence: string[] = [];

  if (unit.status === "pending" || unit.status === "running") {
    reasons.push(unit.status === "pending" ? "unit_not_started" : "unit_in_progress");
    return {
      action: "incomplete",
      reasonCodes: reasons,
      sourceSpan,
      evidence,
      retriesRemaining,
      autoRunAllowed: false,
    };
  }
  if (!sourceIdentityKnown) reasons.push("source_identity_unknown");
  if (!alignmentValid) reasons.push("timeline_invalid");
  if (sourceConflict) reasons.push("transcript_sources_conflict");
  if (!sourceIdentityKnown || !alignmentValid || sourceConflict) {
    if (!sourceIdentityKnown) evidence.push("无法确认该音频区间属于哪位成员");
    if (!alignmentValid) evidence.push("时间轴校验未通过");
    if (sourceConflict) evidence.push("多个转录来源的文字不一致，原始结果均应保留");
    return {
      action: "manual_review",
      reasonCodes: reasons,
      sourceSpan,
      evidence,
      retriesRemaining,
      autoRunAllowed: false,
    };
  }

  const anomaly =
    unit.outputStatus === "repetition_loop" ||
    unit.outputStatus === "abnormal_output" ||
    (unit.anomalyTypes?.length ?? 0) > 0;
  const emptyOnSpeech = unit.outputStatus === "empty_output_on_speech" && unit.commonVad?.hasSpeech;
  if (anomaly || emptyOnSpeech || unit.status === "failed") {
    if (anomaly) {
      reasons.push("asr_output_anomaly");
      evidence.push("检测到可复现的重复或异常转录输出");
    }
    if (emptyOnSpeech) {
      reasons.push("empty_output_on_speech_activity");
      evidence.push("公共语音活动检测标记此区间，但识别结果为空；这仍需结合回听确认");
    }
    if (unit.status === "failed") {
      reasons.push("unit_failed");
      evidence.push(unit.errorCode ?? "处理单元执行失败");
    }
    if (retriesRemaining > 0) {
      return {
        action: "retry_candidate",
        reasonCodes: reasons,
        sourceSpan,
        evidence,
        retriesRemaining,
        autoRunAllowed: Boolean(emptyOnSpeech || anomaly),
      };
    }
    reasons.push("retry_budget_exhausted");
    evidence.push("当前处理单元已用完既有尝试次数");
    return {
      action: "manual_review",
      reasonCodes: reasons,
      sourceSpan,
      evidence,
      retriesRemaining,
      autoRunAllowed: false,
    };
  }

  if (unit.outputStatus === "quiet_audio_uncertain") {
    return {
      action: "manual_review",
      reasonCodes: ["quiet_audio_uncertain"],
      sourceSpan,
      evidence: ["低音量区间无法确认是否有人讲话；不能据此自动补转"],
      retriesRemaining,
      autoRunAllowed: false,
    };
  }

  if (
    unit.status === "completed" &&
    (unit.outputStatus === "normal" || unit.outputStatus === "vad_silence")
  ) {
    if (unit.coveredAudioMs + 1 < unit.endMs - unit.startMs)
      return {
        action: "incomplete",
        reasonCodes: ["unit_coverage_gap"],
        sourceSpan,
        evidence: ["已完成的标记与已核验覆盖范围不一致，需检查原音频"],
        retriesRemaining,
        autoRunAllowed: false,
      };
    return {
      action: "accept",
      reasonCodes: [unit.outputStatus === "vad_silence" ? "confirmed_silence" : "normal_output"],
      sourceSpan,
      evidence: [
        unit.outputStatus === "vad_silence" ? "识别流程将此区间判为静音" : "处理完成且没有明确异常",
      ],
      retriesRemaining,
      autoRunAllowed: false,
    };
  }

  return {
    action: "manual_review",
    reasonCodes: ["insufficient_quality_evidence"],
    sourceSpan,
    evidence: ["当前证据不足以自动确认或补转"],
    retriesRemaining,
    autoRunAllowed: false,
  };
}

/** Supplies persisted identity, timeline and conflict evidence instead of assuming it passed. */
export function reviewTranscriptionUnit(
  record: VoiceMemoryRecord,
  unit: VoiceMemoryTranscriptionUnit,
) {
  return decideTranscriptionQuality({
    unit,
    sourceIdentityKnown:
      !unit.speakerId ||
      record.speakers.some(
        (speaker) => speaker.speakerId === unit.speakerId && speaker.confidence !== "pending",
      ),
    alignmentValid:
      Number.isFinite(unit.startMs) &&
      Number.isFinite(unit.endMs) &&
      unit.startMs >= 0 &&
      unit.endMs > unit.startMs,
    sourceConflict: record.transcriptionFusion?.transcript.some(
      (segment) =>
        segment.fusionUncertain === true &&
        segment.startMs < unit.endMs &&
        segment.endMs > unit.startMs &&
        (!unit.speakerId || unit.speakerId === segment.speakerId),
    ),
  });
}
