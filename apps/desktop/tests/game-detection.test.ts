import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("every detected game has bundled monitor artwork and a readable fallback label", () => {
  const artworkComponentPath = fileURLToPath(
    new URL("../src/renderer/src/components/room/GameMonitorContent.tsx", import.meta.url),
  );
  const artworkDirectory = fileURLToPath(
    new URL("../src/renderer/src/assets/games/", import.meta.url),
  );
  const componentSource = readFileSync(artworkComponentPath, "utf8");
  const expectedArtwork = [
    ["我的世界", "minecraft.png"],
    ["王国保卫战", "kingdom-rush.jpg"],
    ["杀戮尖塔", "slay-the-spire.jpg"],
    ["英雄联盟", "league-of-legends.svg"],
    ["无畏契约", "valorant.png"],
    ["三角洲行动", "delta-force.jpg"],
    ["CS2", "counter-strike-2.jpg"],
    ["Dota 2", "dota-2.jpg"],
    ["Apex 英雄", "apex-legends.jpg"],
    ["绝地求生", "pubg.jpg"],
    ["守望先锋", "overwatch-2.jpg"],
    ["永劫无间", "naraka.jpg"],
    ["原神", "genshin-impact.ico"],
    ["崩坏：星穹铁道", "honkai-star-rail.ico"],
    ["Fortnite", "fortnite.png"],
    ["GTA V", "gta-v.jpg"],
    ["彩虹六号：围攻", "rainbow-six-siege.jpg"],
    ["怪物猎人", "monster-hunter.jpg"],
    ["黑神话：悟空", "black-myth-wukong.jpg"],
    ["失落城堡 2", "lost-castle-2.jpg"],
    ["艾尔登法环", "elden-ring.jpg"],
    ["双人成行", "it-takes-two.jpg"],
    ["幻兽帕鲁", "palworld.jpg"],
    ["胡闹厨房", "overcooked-2.jpg"],
    ["荒野大镖客 2", "red-dead-redemption-2.jpg"],
  ] as const;

  for (const [gameName, filename] of expectedArtwork) {
    assert.equal(componentSource.includes(gameName), true, `${gameName} is missing from catalog`);
    assert.ok(statSync(path.join(artworkDirectory, filename)).size > 500);
  }

  assert.equal(componentSource.includes("scene-game-monitor-content--fallback"), true);
});
