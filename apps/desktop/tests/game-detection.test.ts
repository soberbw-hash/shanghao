import assert from "node:assert/strict";
import test from "node:test";

import { buildGameDetectionProbeCommand, matchKnownGame } from "../src/main/game-detection";

const snapshot = (ProcessName: string, MainWindowTitle = "", Path = ""): string =>
  JSON.stringify({ ProcessName, MainWindowTitle, Path });

test("game detection uses structured exact process matches", () => {
  assert.equal(matchKnownGame(snapshot("LostCastle2-Win64-Shipping")), "失落城堡 2");
  assert.equal(matchKnownGame(snapshot("DeltaForceClient-Win64-Shipping")), "三角洲行动");
  assert.equal(matchKnownGame(snapshot("League of Legends")), "英雄联盟");
  assert.equal(matchKnownGame(snapshot("SlayTheSpire")), "杀戮尖塔");
  assert.equal(matchKnownGame(snapshot("eldenring")), "艾尔登法环");
  assert.equal(matchKnownGame(snapshot("RDR2")), "荒野大镖客 2");
  assert.equal(matchKnownGame(snapshot("notepad", "League of Legends 攻略")), undefined);
  assert.equal(matchKnownGame(snapshot("pal")), undefined);
  assert.equal(matchKnownGame(snapshot("b1")), undefined);
  assert.equal(matchKnownGame(snapshot("playgtav")), undefined);
  assert.equal(matchKnownGame("LostCastle2\r\nexplorer"), undefined);
});

test("generic Java does not falsely report Minecraft", () => {
  assert.equal(
    matchKnownGame(snapshot("javaw", "IntelliJ IDEA", "C:\\Java\\bin\\javaw.exe")),
    undefined,
  );
  assert.equal(
    matchKnownGame(
      snapshot("javaw", "Minecraft 1.21.5", "C:\\Games\\.minecraft\\runtime\\javaw.exe"),
    ),
    "我的世界",
  );
  assert.equal(matchKnownGame(snapshot("Minecraft.Windows")), "我的世界");
  assert.equal(
    matchKnownGame(
      snapshot(
        "Minecraft.Windows",
        "Minecraft",
        "C:\\Program Files\\Minecraft\\Minecraft.Windows.exe",
      ),
    ),
    "我的世界",
  );
});

test("game detection probes process names, window titles, and readable paths every eight seconds", () => {
  const command = buildGameDetectionProbeCommand();

  assert.equal(command.includes("MainWindowTitle"), true);
  assert.equal(command.includes("Path"), true);
  assert.equal(command.includes("ConvertTo-Json"), true);
});
