import assert from "node:assert/strict";
import test from "node:test";
import {
  gameSessionLabel,
  isGameSessionActivity,
  type GameSessionActivity,
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";
import { resolveLeagueActivity, LeagueActivityMonitor } from "../src/main/league-activity";
import { parseLeagueLockfile, parseLeagueCommandLine } from "../src/main/league-client-api";
import { memberStatus } from "../src/renderer/src/features/voice-scene/activityRules";
import { PresenceCoordinator } from "../src/renderer/src/features/room/PresenceCoordinator";
import { isSignalEnvelope } from "@private-voice/signaling";

const now = Date.UTC(2026, 9, 25, 2);
const game = (queueId: number, seconds = 1085) =>
  resolveLeagueActivity(
    {
      phase: "InProgress",
      session: {
        gameData: { queue: { id: queueId }, playerChampionSelections: [{ championId: 99 }] },
      },
      live: { gameTime: seconds, gameMode: "CLASSIC" },
    },
    undefined,
    now,
  )!;

test("lobby exposes actual party count/capacity, never names or champion selections", () => {
  const result = resolveLeagueActivity({
    phase: "Lobby",
    lobby: {
      gameConfig: { queueId: 420, maxLobbySize: 5 },
      members: [{ name: "private-A" }, { name: "private-B" }],
    },
  })!;
  assert.equal(gameSessionLabel(result), "房间中 · 2/5");
  assert.equal(isGameSessionActivity(result), true);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(game(420)).includes("champion"), false);
  const unknownCapacity = resolveLeagueActivity({ phase: "Lobby", lobby: { members: [{}, {}] } })!;
  assert.equal(gameSessionLabel(unknownCapacity), "房间中 · 2人");
});

test("ranked/ARAM/URF use engine gameTime and refresh minutes without re-broadcasting", () => {
  for (const [id, label] of [
    [420, "排位赛"],
    [440, "灵活排位"],
    [450, "大乱斗"],
    [900, "无限火力"],
    [1900, "无限火力"],
  ] as const) {
    const result = game(id);
    assert.equal(gameSessionLabel(result, now), `${label} · 18 分钟`);
    assert.equal(gameSessionLabel(result, now + 60_000), `${label} · 19 分钟`);
  }
  assert.equal(gameSessionLabel(game(420, 0), now), "排位赛 · 0 分钟");
});

test("missing/invalid game time cannot become launch time or claim a ranked mode", () => {
  const result = resolveLeagueActivity({ phase: "InProgress" }, undefined, now)!;
  assert.equal(result.startedAt, undefined);
  assert.equal(gameSessionLabel(result, now), "对局中");
  assert.equal(resolveLeagueActivity({ live: { gameTime: Number.NaN } }), undefined);
  const unknown = resolveLeagueActivity(
    { live: { gameTime: 90, gameMode: "CLASSIC" } },
    undefined,
    now,
  )!;
  assert.equal(unknown.mode, undefined);
  assert.equal(gameSessionLabel(unknown, now), "对局中 · 1 分钟");
});

test("phase transitions do not preserve the last match clock; small clock jitter is coalesced", () => {
  const previous = game(420);
  const updated = resolveLeagueActivity(
    {
      phase: "InProgress",
      session: { gameData: { queue: { id: 420 } } },
      live: { gameTime: 1089.9 },
    },
    previous,
    now + 5000,
  )!;
  assert.equal(updated.startedAt, previous.startedAt);
  const ended = resolveLeagueActivity({ phase: "EndOfGame" }, previous)!;
  assert.equal(ended.startedAt, undefined);
  assert.equal(gameSessionLabel(ended), "对局已结束");
  assert.equal(
    gameSessionLabel(resolveLeagueActivity({ phase: "ChampSelect" })!),
    "对局 · 选择英雄中",
  );
  assert.equal(gameSessionLabel(resolveLeagueActivity({ phase: "None" })!), "客户端中");
  assert.equal(resolveLeagueActivity({ phase: "unknown" }), undefined);
});

test("lockfile authentication only accepts the observed client pid and bounded local port", () => {
  assert.deepEqual(
    parseLeagueCommandLine(
      '"LeagueClientUx.exe" "--app-port=12345" "--remoting-auth-token=synthetic"',
    ),
    { port: 12345, password: "synthetic" },
  );
  assert.equal(
    parseLeagueCommandLine("--app-port=70000 --remoting-auth-token=synthetic"),
    undefined,
  );
  const pids = new Set([123]);
  assert.deepEqual(parseLeagueLockfile("LeagueClient:123:29999:synthetic:https", pids), {
    port: 29999,
    password: "synthetic",
  });
  for (const value of [
    "LeagueClient:124:29999:synthetic:https",
    "LeagueClient:123:70000:synthetic:https",
    "LeagueClient:123:29999:synthetic:http",
    "LeagueClient:123:29999:secret\nextra:https",
  ])
    assert.equal(parseLeagueLockfile(value, pids), undefined);
});

test("monitor does not overlap reads; stop and a replacement client reject late responses", async () => {
  const changes: (GameSessionActivity | undefined)[] = [];
  const pending: ((value: { phase: string }) => void)[] = [];
  const monitor = new LeagueActivityMonitor(
    (value) => changes.push(value),
    async () => new Promise((resolve) => pending.push(resolve)),
  );
  try {
    monitor.watch([{ ProcessName: "LeagueClient", ProcessId: 1 }]);
    await monitor.refresh();
    assert.equal(pending.length, 1);
    monitor.watch([{ ProcessName: "LeagueClient", ProcessId: 2 }]);
    pending[0]!({ phase: "Lobby" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(changes.length, 0);
    pending[1]!({ phase: "ChampSelect" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(changes[0]?.phase, "champ-select");
    monitor.stop();
    assert.equal(changes.at(-1), undefined);
  } finally {
    monitor.stop();
  }
});

test("wire validator rejects extra data, unknown modes, malformed clocks and impossible party counts", () => {
  const good = game(420);
  for (const value of [
    { ...good, champion: "private" },
    { ...good, mode: "<script>" },
    { ...good, startedAt: Infinity },
    { ...good, partySize: 6, partyCapacity: 5 },
  ])
    assert.equal(isGameSessionActivity(value), false);
  assert.equal(
    isSignalEnvelope({ type: "member_state", roomId: "main", peerId: "one", gameSession: good }),
    true,
  );
  assert.equal(
    isSignalEnvelope({
      type: "member_state",
      roomId: "main",
      peerId: "one",
      gameSession: { ...good, password: "private" },
    }),
    false,
  );
});

test("speaking and mute patches keep rich presence while explicit null clears it", async () => {
  const sent: Record<string, unknown>[] = [];
  const coordinator = new PresenceCoordinator({
    roomId: "main",
    peerId: "one",
    canPublish: () => true,
    send: async (value) => {
      sent.push(value as unknown as Record<string, unknown>);
      return true;
    },
  });
  const session = game(420);
  coordinator.update(
    false,
    "gaming",
    "gameDesk1",
    "英雄联盟",
    undefined,
    undefined,
    false,
    session,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent[0]?.gameSession, session);
  assert.deepEqual(
    coordinator.enrichPartialMessage({
      type: "member_state",
      roomId: "main",
      peerId: "one",
      isSpeaking: true,
    }).gameSession,
    session,
  );
  assert.equal(
    coordinator.enrichPartialMessage({
      type: "member_state",
      roomId: "main",
      peerId: "one",
      gameSession: null,
    }).gameSession,
    null,
  );
  const member = {
    presenceState: MemberPresenceState.Online,
    speakingState: MemberSpeakingState.Speaking,
    gameName: "英雄联盟",
    gameSession: session,
  } as RoomMember;
  assert.equal(memberStatus(member, now).label, "排位赛 · 18 分钟");
  assert.equal(memberStatus(member, now).tone, "speaking");
  assert.equal(memberStatus({ ...member, isMuted: true }, now).label, "静音中");
});
