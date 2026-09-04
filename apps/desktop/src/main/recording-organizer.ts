import { randomUUID } from "node:crypto";

import {
  buildReadableTranscriptParagraphs,
  isReliableTranscriptText,
  type VoiceMemoryOrganizationChunk,
  type VoiceMemoryOrganizationMoment,
  type VoiceMemoryOrganizationParticipant,
  type VoiceMemoryOrganizationResult,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

const TARGET_CHUNK_MS = 45 * 60_000;
const MIN_CHUNK_MS = 30 * 60_000;
const MAX_CHUNK_MS = 60 * 60_000;
// The 4060 Ti 8GB reference machine leaves about 8.2k KV tokens after FreeToken
// loads Qwen3.6-35B-A3B. Dense speech makes this model produce substantially
// more JSON than the prompt requests, so keep input near 3.2k and reserve the
// rest for a complete answer. Quiet recordings still use natural time bounds.
const MAX_ESTIMATED_INPUT_TOKENS = 3_200;
const PIPELINE_OVERHEAD_TOKENS = 1_200;

export const RECORDING_ORGANIZATION_PIPELINE_VERSION = 5;

export interface RecordingOrganizationChunkPlan {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceSegmentIds: string[];
  estimatedInputTokens: number;
}

const segmentTokenEstimate = (segment: VoiceMemoryTranscriptSegment): number => {
  const text = `${segment.nickname ?? segment.speakerId}: ${segment.text}`;
  const han = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
  const remaining = Math.max(0, text.length - han);
  return Math.max(1, han + Math.ceil(remaining / 3.5) + 12);
};

const usableSegments = (record: VoiceMemoryRecord): VoiceMemoryTranscriptSegment[] =>
  [...record.transcript]
    .filter((segment) =>
      isReliableTranscriptText(segment.text, Math.max(100, segment.endMs - segment.startMs)),
    )
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

const boundaryScore = (
  segments: readonly VoiceMemoryTranscriptSegment[],
  index: number,
  chunkStartMs: number,
): number => {
  const current = segments[index];
  const next = segments[index + 1];
  if (!current || !next) return Number.POSITIVE_INFINITY;
  const gapMs = Math.max(0, next.startMs - current.endMs);
  const durationMs = current.endMs - chunkStartMs;
  const targetPenalty = Math.abs(durationMs - TARGET_CHUNK_MS) / 60_000;
  // Long silence and sentence boundaries are the reliable signals already present in ASR data.
  return Math.min(180, gapMs / 1_000) * 4 - targetPenalty;
};

/**
 * Creates contiguous, non-overlapping chunks. It prefers silence near 45 minutes, but a token
 * ceiling may split earlier so a busy gaming session never overruns FreeToken prefill limits.
 */
export const planRecordingOrganizationChunks = (
  record: VoiceMemoryRecord,
): RecordingOrganizationChunkPlan[] => {
  const segments = usableSegments(record);
  if (segments.length === 0) return [];
  const plans: RecordingOrganizationChunkPlan[] = [];
  let chunkStartIndex = 0;
  let estimatedTokens = PIPELINE_OVERHEAD_TOKENS;

  const commit = (endIndex: number) => {
    const selected = segments.slice(chunkStartIndex, endIndex + 1);
    const first = selected[0];
    if (!first) return;
    const selectedTokens =
      PIPELINE_OVERHEAD_TOKENS +
      selected.reduce((sum, segment) => sum + segmentTokenEstimate(segment), 0);
    plans.push({
      id: `organization-${plans.length + 1}-${first.id}`,
      index: plans.length,
      startMs: first.startMs,
      endMs: selected.at(-1)?.endMs ?? first.endMs,
      sourceSegmentIds: selected.map((segment) => segment.id),
      estimatedInputTokens: selectedTokens,
    });
    chunkStartIndex = endIndex + 1;
    estimatedTokens = PIPELINE_OVERHEAD_TOKENS;
  };

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const chunkStart = segments[chunkStartIndex];
    if (!segment || !chunkStart) continue;
    estimatedTokens += segmentTokenEstimate(segment);
    const chunkStartMs = chunkStart.startMs;
    const duration = segment.endMs - chunkStartMs;
    const tokenLimitReached = estimatedTokens >= MAX_ESTIMATED_INPUT_TOKENS;
    const durationLimitReached = duration >= MAX_CHUNK_MS;
    if (!tokenLimitReached && !durationLimitReached && index < segments.length - 1) continue;

    // When the segment that was just added crosses the real 8GB KV ceiling,
    // keep it for the next chunk. This guarantees the current chunk stays
    // below the input budget instead of reporting/feeding a small overrun.
    let endIndex = tokenLimitReached && index > chunkStartIndex ? index - 1 : index;
    if (index < segments.length - 1) {
      const preferredStart = tokenLimitReached
        ? // A token-forced split may move back a few transcript items to land on
          // a better silence, but must never collapse a dense block into a chain
          // of one-segment chunks.
          Math.max(chunkStartIndex, endIndex - 2)
        : segments.findIndex(
            (segment, candidateIndex) =>
              candidateIndex >= chunkStartIndex && segment.endMs - chunkStartMs >= MIN_CHUNK_MS,
          );
      const searchStart = Math.max(
        chunkStartIndex,
        preferredStart < 0 ? chunkStartIndex : preferredStart,
      );
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let candidate = searchStart; candidate <= endIndex; candidate += 1) {
        const score = boundaryScore(segments, candidate, chunkStartMs);
        if (score > bestScore) {
          bestScore = score;
          endIndex = candidate;
        }
      }
    }
    commit(endIndex);
    index = endIndex;
  }
  if (chunkStartIndex < segments.length) commit(segments.length - 1);
  return plans;
};

export const materializeOrganizationChunks = (
  plans: readonly RecordingOrganizationChunkPlan[],
  previous: readonly VoiceMemoryOrganizationChunk[] | undefined,
): VoiceMemoryOrganizationChunk[] => {
  const existing = new Map((previous ?? []).map((chunk) => [chunk.id, chunk]));
  const now = new Date().toISOString();
  return plans.map((plan) => {
    const saved = existing.get(plan.id);
    const compatible =
      saved &&
      saved.startMs === plan.startMs &&
      saved.endMs === plan.endMs &&
      saved.sourceSegmentIds.join("\0") === plan.sourceSegmentIds.join("\0");
    if (compatible) {
      return saved.status === "running"
        ? { ...saved, status: "pending", updatedAt: now }
        : { ...saved, ...plan };
    }
    return { ...plan, status: "pending", attempts: 0, updatedAt: now };
  });
};

export const transcriptForOrganizationChunk = (
  record: VoiceMemoryRecord,
  chunk: Pick<VoiceMemoryOrganizationChunk, "sourceSegmentIds">,
): string => {
  const ids = new Set(chunk.sourceSegmentIds);
  const selected = usableSegments(record).filter((segment) => ids.has(segment.id));
  return buildReadableTranscriptParagraphs(selected)
    .map((paragraph) => {
      const sourceSegmentIds = paragraph.sourceSegmentIds.filter((id) => ids.has(id));
      return `[${formatOrganizationTimestamp(paragraph.startMs)}｜${paragraph.nickname ?? "未知"}｜speakerId=${paragraph.speakerId}｜sourceSegmentIds=${sourceSegmentIds.join(",")}] ${paragraph.text}`;
    })
    .join("\n");
};

const formatOrganizationTimestamp = (timeMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
};

const sourceSegmentSet = (record: VoiceMemoryRecord): Set<string> =>
  new Set(record.transcript.map((segment) => segment.id));

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];

const finiteTime = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback;
};

const normalizeMoment = (
  raw: Record<string, unknown>,
  prefix: string,
  index: number,
  record: VoiceMemoryRecord,
  fallbackStart: number,
  fallbackEnd: number,
): VoiceMemoryOrganizationMoment | undefined => {
  const title = String(raw.title ?? "").trim();
  const description = String(raw.description ?? raw.text ?? "").trim();
  if (!title && !description) return undefined;
  const validSegments = sourceSegmentSet(record);
  const sourceSegmentIds = stringArray(raw.sourceSegmentIds).filter((id) => validSegments.has(id));
  const matched = record.transcript.filter((segment) => sourceSegmentIds.includes(segment.id));
  const startMs = finiteTime(raw.startTime ?? raw.startMs, matched[0]?.startMs ?? fallbackStart);
  const endMs = Math.max(
    startMs,
    finiteTime(raw.endTime ?? raw.endMs, matched.at(-1)?.endMs ?? fallbackEnd),
  );
  return {
    id: String(raw.id ?? `${prefix}-${index + 1}-${randomUUID().slice(0, 8)}`),
    title: title || description.slice(0, 30),
    description,
    startMs,
    endMs,
    speakerIds: stringArray(raw.speakerIds),
    sourceSegmentIds,
  };
};

export const participantSpeakingShares = (
  record: VoiceMemoryRecord,
): VoiceMemoryOrganizationParticipant[] => {
  const durations = new Map<string, { duration: number; ids: string[]; nickname?: string }>();
  for (const segment of usableSegments(record)) {
    const current = durations.get(segment.speakerId) ?? {
      duration: 0,
      ids: [],
      nickname: segment.nickname,
    };
    current.duration += Math.max(0, segment.endMs - segment.startMs);
    current.ids.push(segment.id);
    current.nickname ??= segment.nickname;
    durations.set(segment.speakerId, current);
  }
  const total = [...durations.values()].reduce((sum, item) => sum + item.duration, 0);
  return [...durations.entries()]
    .map(([speakerId, item]) => ({
      speakerId,
      nickname: item.nickname,
      speakingSharePercent: total > 0 ? Number(((item.duration / total) * 100).toFixed(1)) : 0,
      sourceSegmentIds: item.ids,
    }))
    .sort((left, right) => (right.speakingSharePercent ?? 0) - (left.speakingSharePercent ?? 0));
};

export const normalizeOrganizationResult = (
  value: unknown,
  record: VoiceMemoryRecord,
  fallbackStart = 0,
  fallbackEnd = record.transcript.at(-1)?.endMs ?? 0,
): VoiceMemoryOrganizationResult => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const moments = (key: string, prefix: string) =>
    (Array.isArray(raw[key]) ? raw[key] : [])
      .map((item, index) =>
        item && typeof item === "object"
          ? normalizeMoment(
              item as Record<string, unknown>,
              prefix,
              index,
              record,
              fallbackStart,
              fallbackEnd,
            )
          : undefined,
      )
      .filter((item): item is VoiceMemoryOrganizationMoment => Boolean(item));
  const topics = moments("topics", "topic").map((moment) => ({ ...moment }));
  const summary = (Array.isArray(raw.summary) ? raw.summary : [])
    .map((item) => {
      if (typeof item === "string") return { text: item.trim() };
      if (!item || typeof item !== "object") return undefined;
      const entry = item as Record<string, unknown>;
      const text = String(entry.text ?? entry.description ?? "").trim();
      if (!text) return undefined;
      return {
        text,
        sourceStartMs: finiteTime(entry.sourceStartMs ?? entry.startTime, fallbackStart),
        sourceSegmentIds: stringArray(entry.sourceSegmentIds).filter((id) =>
          sourceSegmentSet(record).has(id),
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const modelParticipants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const entry = item as Record<string, unknown>;
      const speakerId = String(entry.speakerId ?? "").trim();
      if (!speakerId) return undefined;
      return {
        speakerId,
        nickname: typeof entry.nickname === "string" ? entry.nickname.trim() : undefined,
        description: typeof entry.description === "string" ? entry.description.trim() : undefined,
        sourceSegmentIds: stringArray(entry.sourceSegmentIds),
      };
    })
    .filter(Boolean) as VoiceMemoryOrganizationParticipant[];
  const deterministicParticipants = participantSpeakingShares(record);
  const participantById = new Map(
    modelParticipants.map((participant) => [participant.speakerId, participant]),
  );
  return {
    description: String(raw.description ?? "").trim(),
    summary,
    topics,
    timeline: moments("timeline", "timeline"),
    highlights: moments("highlights", "highlight"),
    funnyMoments: moments("funnyMoments", "funny"),
    importantInformation: moments("importantInformation", "important"),
    participants: deterministicParticipants.map((participant) => ({
      ...participant,
      ...participantById.get(participant.speakerId),
      speakingSharePercent: participant.speakingSharePercent,
      sourceSegmentIds: participant.sourceSegmentIds,
    })),
    keywords: stringArray(raw.keywords).slice(0, 40),
  };
};

export const organizationChunkPrompt = (
  record: VoiceMemoryRecord,
  chunk: VoiceMemoryOrganizationChunk,
): string =>
  [
    "你是上号的本地录音整理助手。内容是朋友开黑和聊天，不是会议。",
    "只依据下面原文，玩笑不要当事实，不确定就保留不确定性，禁止编造。",
    "重点找朋友之间真实发生的有趣互动：谁坑了、谁送了、谁带飞、谁嘴硬、谁吐槽或骂了两句。可以用朋友视角轻松调侃，但必须能由原文直接支持；游戏内互损不要误写成真实冲突。",
    "返回一个 JSON 对象，字段必须为 description、summary、topics、timeline、highlights、funnyMoments、importantInformation、participants、keywords。",
    "summary 的元素为 {text,sourceStartMs,sourceSegmentIds}。",
    "topics/timeline/highlights/funnyMoments/importantInformation 的元素为 {id,title,description,startTime,endTime,speakerIds,sourceSegmentIds}。",
    "participants 的元素为 {speakerId,nickname,description,sourceSegmentIds}。每个引用都必须使用对话段落给出的 sourceSegmentIds；时间使用段落开头的粗时间，不要编造更细时间。",
    "整个 JSON 必须少于3000个字符。必须精简：description 不超过60字；summary 最多2项；topics 最多3项；timeline 最多4项；highlights 最多2项；funnyMoments 最多2项；importantInformation 最多2项；keywords 最多8项。",
    "每个 title 不超过14字，每个条目的 description 不超过45字；participants 只写 speakerId、nickname、空 description 和 sourceSegmentIds。没有可靠内容的数组直接返回空数组。",
    "每个项目的 sourceSegmentIds 只保留最直接的1至2个原文段，不要为了凑数量重复同一件事。",
    "JSON 完整闭合优先于条目数量；内容放不下时必须继续删减条目，绝不能输出半截 JSON。",
    `本块原始范围：${formatOrganizationTimestamp(chunk.startMs)}-${formatOrganizationTimestamp(chunk.endMs)}；录音：${record.filePath}`,
    transcriptForOrganizationChunk(record, chunk),
  ].join("\n");

export const organizationFinalPrompt = (
  record: VoiceMemoryRecord,
  chunkResults: readonly VoiceMemoryOrganizationResult[],
): string =>
  [
    "你是上号的本地录音整理助手。请把多个连续分块结果汇总成整场记录。",
    "风格自然、简短、有人味，不写会议套话；不得添加分块结果中没有的事实。",
    "最终口吻像一个一起开黑的朋友在复盘：优先保留坑队友、带飞、互损、爆笑口误和情绪反转；调侃可以有梗，但不能凭空给任何人扣锅，也不能把玩笑升级成真实矛盾。",
    "去掉重复内容，但保留所有重要时间范围、speakerIds 和 sourceSegmentIds，方便跳回录音。",
    "只返回 JSON：description、summary、topics、timeline、highlights、funnyMoments、importantInformation、participants、keywords。字段结构与输入相同。",
    "保持简洁：description 不超过160字；summary 最多6项；topics 最多8项；timeline 最多12项；highlights/funnyMoments/importantInformation 各最多8项；keywords 最多20项。",
    "每个项目只保留最直接的1至3个 sourceSegmentIds，不得删除输入中互不重复的重要时间范围。",
    `录音：${record.filePath}`,
    JSON.stringify(chunkResults),
  ].join("\n");
