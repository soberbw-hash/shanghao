import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  hasLeagueLobbyParty,
  LeagueLobbyMonitor,
} from "../src/renderer/src/components/room/LeagueLobbyMonitor";
import type { GameSessionActivity } from "@private-voice/shared";

test("waiting picture requires actual current occupancy and never carries a previous match", () => {
  const session: GameSessionActivity = {
    source: "league",
    phase: "lobby",
    mode: "大乱斗",
    partySize: 1,
    partyCapacity: 5,
  };
  assert.equal(hasLeagueLobbyParty(session), true);
  if (!hasLeagueLobbyParty(session)) throw new Error("expected party");
  const markup = renderToStaticMarkup(createElement(LeagueLobbyMonitor, { session }));
  assert.equal((markup.match(/data-occupied="true"/g) ?? []).length, 1);
  assert.equal((markup.match(/data-occupied="false"/g) ?? []).length, 4);
  assert.match(markup, /等待队友/);
  assert.match(markup, /1\/5/);
  for (const invalid of [
    undefined,
    { ...session, partyCapacity: undefined },
    { ...session, partySize: 6 },
    { ...session, phase: "in-game" as const },
    { ...session, phase: "champ-select" as const },
  ])
    assert.equal(hasLeagueLobbyParty(invalid), false);
});
