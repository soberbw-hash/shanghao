import type {
  RecordingLibraryItem,
  VoiceMemorySearchRequest,
  VoiceMemorySearchResult,
  VoiceMemorySummary,
} from "@private-voice/shared";

export interface RecordingLibraryFilters {
  roomId: string;
  dateFrom: string;
  dateTo: string;
  transcript: "all" | "has" | "none" | "working" | "failed";
}
export const EMPTY_RECORDING_FILTERS: RecordingLibraryFilters = {
  roomId: "",
  dateFrom: "",
  dateTo: "",
  transcript: "all",
};
const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
export const recordingSearchDate = (createdAt: string): string => {
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "";
};
const matchingMemory = (item: RecordingLibraryItem, memory?: VoiceMemorySummary) =>
  memory?.recordingId === item.recordingId &&
  memory.filePath === item.filePath &&
  memory.roomId === item.roomId
    ? memory
    : undefined;
const hasTranscript = (memory?: VoiceMemorySummary) =>
  Boolean(memory && memory.transcriptCount > 0 && !memory.invalidResult);

export const filterRecordingLibrary = (
  items: RecordingLibraryItem[],
  memories: Record<string, VoiceMemorySummary>,
  filters: RecordingLibraryFilters,
): RecordingLibraryItem[] =>
  items.filter((item) => {
    if (
      filters.roomId === "unassigned"
        ? Boolean(item.roomId)
        : filters.roomId && item.roomId !== filters.roomId
    )
      return false;
    const date = recordingSearchDate(item.createdAt || item.modifiedAt);
    if (
      (filters.dateFrom || filters.dateTo) &&
      (!date ||
        (filters.dateFrom && date < filters.dateFrom) ||
        (filters.dateTo && date > filters.dateTo))
    )
      return false;
    const memory = matchingMemory(item, memories[item.recordingId]);
    if (filters.transcript === "has") return hasTranscript(memory);
    if (filters.transcript === "none") return !hasTranscript(memory);
    if (filters.transcript === "working")
      return memory?.phase === "transcribing" || memory?.phase === "organizing";
    if (filters.transcript === "failed") return memory?.phase === "error";
    return true;
  });

export const filterRecordingSearchResults = (
  results: VoiceMemorySearchResult[],
  items: RecordingLibraryItem[],
  memories: Record<string, VoiceMemorySummary>,
): VoiceMemorySearchResult[] => {
  const allowed = new Map(items.map((item) => [item.recordingId, item]));
  return results.filter((result) => {
    const item = allowed.get(result.recordingId);
    return (
      result.kind === "transcript" &&
      Number.isFinite(result.startMs) &&
      result.startMs >= 0 &&
      item?.filePath === result.filePath &&
      hasTranscript(matchingMemory(item, memories[item.recordingId]))
    );
  });
};

export const recordingSearchRequest = (
  query: string,
  filters: RecordingLibraryFilters,
): VoiceMemorySearchRequest => ({
  query: query.trim(),
  roomId: filters.roomId && filters.roomId !== "unassigned" ? filters.roomId : undefined,
  // The index dates refer to memory creation, which may be days after recording.
  // Apply recording dates against library metadata, never exclude an old audio
  // file just because its transcript was produced later.
  limit: 100,
});

export const recordingSearchTimingLabel = (memory: VoiceMemorySummary | undefined): string => {
  const model = memory?.transcriptionModel?.id;
  if (!model) return "时间来源未记录，请回听确认";
  return ["siliconflow-sensevoice-small", "custom-asr-api"].includes(model)
    ? "云端估算位置，回听定位到附近"
    : "本地转录位置";
};

export const createRecordingSearchSession = (
  search: (request: VoiceMemorySearchRequest) => Promise<VoiceMemorySearchResult[]>,
) => {
  let generation = 0;
  return {
    async run(request: VoiceMemorySearchRequest): Promise<VoiceMemorySearchResult[] | undefined> {
      const own = ++generation;
      try {
        const results = await search(request);
        return own === generation ? results : undefined;
      } catch (error) {
        if (own === generation) throw error;
        return undefined;
      }
    },
    cancel() {
      generation += 1;
    },
  };
};
