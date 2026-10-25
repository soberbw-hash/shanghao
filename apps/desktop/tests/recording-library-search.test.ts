import assert from "node:assert/strict";
import test from "node:test";
import type {
  RecordingLibraryItem,
  VoiceMemorySearchResult,
  VoiceMemorySummary,
} from "@private-voice/shared";
import {
  filterRecordingLibrary,
  filterRecordingSearchResults,
  recordingSearchRequest,
  recordingSearchTimingLabel,
  createRecordingSearchSession,
} from "../src/renderer/src/features/recording/recordingLibrarySearch";

const item = (id: string, date: string, roomId?: string): RecordingLibraryItem => ({
  id,
  recordingId: id,
  filePath: `${id}.m4a`,
  fileName: `${id}.m4a`,
  mediaUrl: "",
  title: id,
  createdAt: date,
  modifiedAt: date,
  fileSize: 100,
  roomId,
  roomName: "同名房间",
  isFavorite: false,
  markers: [],
});
const items = [
  item("before", "2026-10-18T15:59:59.999Z", "room-a"),
  item("first", "2026-10-18T16:00:00.000Z", "room-a"),
  item("last", "2026-10-19T15:59:59.999Z", "room-a"),
  item("after", "2026-10-19T16:00:00.000Z", "room-a"),
  item("other", "2026-10-19T00:00:00.000Z", "room-b"),
  item("legacy", "2026-10-19T00:00:00.000Z"),
];
const summary = (
  entry: RecordingLibraryItem,
  patch: Partial<VoiceMemorySummary> = {},
): VoiceMemorySummary => ({
  recordingId: entry.recordingId,
  filePath: entry.filePath,
  roomId: entry.roomId,
  createdAt: entry.createdAt,
  updatedAt: entry.createdAt,
  phase: "ready",
  progress: 100,
  transcriptCount: 1,
  speakerCount: 0,
  chapterCount: 0,
  highlightCount: 0,
  markerCount: 0,
  ...patch,
});
const memories = Object.fromEntries(items.map((entry) => [entry.recordingId, summary(entry)]));
const filters = {
  roomId: "room-a",
  dateFrom: "2026-10-19",
  dateTo: "2026-10-19",
  transcript: "all" as const,
};
const result = (entry: RecordingLibraryItem): VoiceMemorySearchResult => ({
  recordingId: entry.recordingId,
  filePath: entry.filePath,
  createdAt: entry.createdAt,
  startMs: 12345,
  title: "战术",
  excerpt: "一起讨论战术",
  score: 2,
  kind: "transcript",
});

test("room identity and Shanghai inclusive dates isolate same-named rooms and midnight boundaries", () => {
  assert.deepEqual(
    filterRecordingLibrary(items, memories, filters).map((entry) => entry.id),
    ["first", "last"],
  );
  assert.deepEqual(
    filterRecordingLibrary(items, memories, { ...filters, roomId: "unassigned" }).map(
      (entry) => entry.id,
    ),
    ["legacy"],
  );
  assert.deepEqual(
    filterRecordingLibrary(items, memories, { ...filters, dateFrom: "2026-10-20" }),
    [],
  );
  assert.equal(recordingSearchRequest(" 战术 ", filters).roomId, "room-a");
  assert.equal(recordingSearchRequest("战术", filters).dateFrom, undefined);
  assert.equal(recordingSearchRequest("战术", filters).dateTo, undefined);
});

test("transcript filters distinguish absent, invalid, working and failed records without reading bodies", () => {
  const statuses = {
    first: summary(items[1]!, { transcriptCount: 0 }),
    last: summary(items[2]!, { invalidResult: true }),
    after: summary(items[3]!, { phase: "transcribing" }),
    other: summary(items[4]!, { phase: "error" }),
  };
  const scope = { roomId: "", dateFrom: "", dateTo: "", transcript: "none" as const };
  assert.deepEqual(
    filterRecordingLibrary(items, statuses, scope).map((entry) => entry.id),
    ["before", "first", "last", "legacy"],
  );
  assert.deepEqual(
    filterRecordingLibrary(items, statuses, { ...scope, transcript: "working" }).map(
      (entry) => entry.id,
    ),
    ["after"],
  );
  assert.deepEqual(
    filterRecordingLibrary(items, statuses, { ...scope, transcript: "failed" }).map(
      (entry) => entry.id,
    ),
    ["other"],
  );
});

test("search refuses cross-room summaries, moved sources, no transcript and stale filtered results", () => {
  const visible = filterRecordingLibrary(items, memories, filters);
  const entries = items.map(result);
  assert.deepEqual(
    filterRecordingSearchResults(entries, visible, memories).map((entry) => entry.recordingId),
    ["first", "last"],
  );
  const changed = {
    ...memories,
    first: summary(items[1]!, { roomId: "room-b" }),
    last: summary(items[2]!, { transcriptCount: 0 }),
  };
  assert.deepEqual(filterRecordingSearchResults(entries, visible, changed), []);
  assert.deepEqual(
    filterRecordingSearchResults(
      [{ ...result(items[1]!), filePath: "moved.m4a" }],
      visible,
      memories,
    ),
    [],
  );
  assert.deepEqual(
    filterRecordingSearchResults([{ ...result(items[1]!), kind: "marker" }], visible, memories),
    [],
  );
});

test("cancelled and superseded search responses never become a new result", async () => {
  const pending: Array<(value: VoiceMemorySearchResult[]) => void> = [];
  const session = createRecordingSearchSession(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const request = recordingSearchRequest("战术", filters);
  const old = session.run(request);
  session.cancel();
  const current = session.run(request);
  pending[0]!([result(items[1]!)]);
  assert.equal(await old, undefined);
  pending[1]!([result(items[2]!)]);
  assert.deepEqual(
    (await current)?.map((entry) => entry.recordingId),
    ["last"],
  );
  const cancelled = session.run(request);
  session.cancel();
  pending[2]!([]);
  assert.equal(await cancelled, undefined);
});

test("cloud positions explicitly remain estimates while local and unknown origins retain honest labels", () => {
  const cloud = summary(items[1]!, { transcriptionModel: { id: "custom-asr-api", name: "云端" } });
  assert.match(recordingSearchTimingLabel(cloud), /云端.*估算/);
  assert.match(
    recordingSearchTimingLabel(
      summary(items[1]!, { transcriptionModel: { id: "paraformer-zh", name: "本地" } }),
    ),
    /本地/,
  );
  assert.match(recordingSearchTimingLabel(undefined), /来源未记录/);
});
