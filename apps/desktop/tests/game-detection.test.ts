import assert from "node:assert/strict";
import test from "node:test";

import { buildGameDetectionProbeCommand, matchKnownGame } from "../src/main/game-detection";

test("game detection exposes only known friendly game names", () => {
  assert.equal(matchKnownGame("LostCastle2\r\nexplorer"), "失落城堡2");
  assert.equal(matchKnownGame("Lost Castle 2\r\nSteam"), "失落城堡2");
  assert.equal(
    matchKnownGame('{"ProcessName":"LostCastle2-Win64-Shipping","Path":"D:\\\\Steam\\\\Lost Castle 2\\\\LostCastle2.exe"}'),
    "失落城堡2",
  );
  assert.equal(matchKnownGame("DeltaForce\r\nexplorer"), "三角洲行动");
  assert.equal(matchKnownGame("LeagueClient\r\nDiscord"), "英雄联盟");
  assert.equal(matchKnownGame("League of Legends\r\nRiotClientServices"), "英雄联盟");
  assert.equal(
    matchKnownGame('{"ProcessName":"LeagueClientUxRender","MainWindowTitle":"英雄联盟"}'),
    "英雄联盟",
  );
  assert.equal(matchKnownGame("notepad\r\nprivate-window-title"), undefined);
});

test("game detection probes process names, window titles, and readable paths", () => {
  const command = buildGameDetectionProbeCommand();

  assert.equal(command.includes("MainWindowTitle"), true);
  assert.equal(command.includes("Path"), true);
  assert.equal(command.includes("ConvertTo-Json"), true);
});
