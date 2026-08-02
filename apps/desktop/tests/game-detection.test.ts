import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildGameDetectionProbeCommand,
  matchKnownGame,
  matchMusicActivity,
  resolveStableMusicActivity,
} from "../src/main/game-detection";

const snapshot = (ProcessName: string, MainWindowTitle = "", Path = "", CommandLine = ""): string =>
  JSON.stringify({ ProcessName, MainWindowTitle, Path, CommandLine });

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

test("music detection reports the active track without treating an idle player as music", () => {
  assert.deepEqual(matchMusicActivity(snapshot("Spotify", "Midnight City - M83 - Spotify")), {
    provider: "spotify",
    providerName: "Spotify",
    trackTitle: "Midnight City",
    artist: "M83",
  });
  assert.deepEqual(matchMusicActivity(snapshot("cloudmusic", "晴天 - 周杰伦 - 网易云音乐")), {
    provider: "netease",
    providerName: "网易云音乐",
    trackTitle: "晴天",
    artist: "周杰伦",
  });
  assert.equal(matchMusicActivity(snapshot("QQMusic", "QQ音乐")), undefined);
  assert.equal(matchMusicActivity(snapshot("explorer", "Spotify playlist")), undefined);
});

test("music activity survives transient title misses without becoming permanently stale", () => {
  const activity = matchMusicActivity(snapshot("cloudmusic", "晴天 - 周杰伦 - 网易云音乐"));

  assert.ok(activity);
  assert.equal(resolveStableMusicActivity(undefined, activity, 1), activity);
  assert.equal(resolveStableMusicActivity(undefined, activity, 2), activity);
  assert.equal(resolveStableMusicActivity(undefined, activity, 3), activity);
  assert.equal(resolveStableMusicActivity(undefined, activity, 4), undefined);

  const changed = matchMusicActivity(snapshot("cloudmusic", "夜曲 - 周杰伦 - 网易云音乐"));
  assert.equal(resolveStableMusicActivity(changed, activity, 0), changed);
});

test("KK launcher alone never reports a game", () => {
  assert.equal(
    matchKnownGame(
      snapshot(
        "KK",
        "KK 对战平台 - 向魔兽开炮",
        "C:\\Program Files\\KK\\KK.exe",
        '"C:\\Program Files\\KK\\KK.exe" --map 向魔兽开炮',
      ),
    ),
    undefined,
  );
  assert.equal(
    matchKnownGame(snapshot("KKGameBox", "尸潮庇护所", "C:\\Games\\KK\\KKGameBox.exe")),
    undefined,
  );
  assert.equal(
    matchKnownGame(
      snapshot(
        "Platform",
        "KK 官方对战平台 - 向魔兽开炮",
        "C:\\Program Files (x86)\\kkduizhan\\Platform.exe",
      ),
    ),
    undefined,
  );
});

test("KK hosted games require a real game process and prefer the exact map", () => {
  assert.equal(
    matchKnownGame(
      snapshot(
        "war3",
        "",
        "D:\\KK\\Games\\Warcraft III\\war3.exe",
        '"D:\\KK\\Games\\Warcraft III\\war3.exe" -loadfile "向魔兽开炮"',
      ),
    ),
    "向魔兽开炮",
  );
  assert.equal(
    matchKnownGame(
      snapshot(
        "game",
        "最后的避难所3",
        "D:\\KK\\Games\\y3\\2.0\\game\\game.exe",
        '"D:\\KK\\Games\\y3\\2.0\\game\\game.exe" --map 尸潮庇护所',
      ),
    ),
    "尸潮庇护所",
  );
  assert.equal(
    matchKnownGame(snapshot("war3", "DotA Allstars", "D:\\KK\\Games\\war3.exe")),
    "DotA 1",
  );
  assert.equal(
    matchKnownGame(
      snapshot(
        "Game_x64h",
        "",
        "C:\\Program Files (x86)\\kkduizhan\\Games\\y3\\2.0\\game\\Engine\\Binaries\\Win64\\Game_x64h.exe",
        '"Game_x64h.exe" --project 205715',
      ),
    ),
    "向魔兽开炮",
  );
  assert.equal(
    matchKnownGame(
      snapshot(
        "Game_x64h",
        "",
        "C:\\Program Files (x86)\\kkduizhan\\Games\\y3\\2.0\\game\\Engine\\Binaries\\Win64\\Game_x64h.exe",
      ),
    ),
    "KK RPG",
  );
  assert.equal(matchKnownGame(snapshot("war3", "Warcraft III")), "魔兽争霸 3");
  assert.equal(matchKnownGame(snapshot("game", "普通应用")), undefined);
});

test("KK classic games use their actual processes instead of the platform process", () => {
  assert.equal(
    matchKnownGame(
      snapshot("hl", "Counter-Strike 1.6", "D:\\KK\\Games\\CS1.6\\hl.exe", "-game cstrike"),
    ),
    "CS 1.6",
  );
  assert.equal(matchKnownGame(snapshot("hl", "Half-Life SDK")), undefined);
  assert.equal(matchKnownGame(snapshot("gamemd")), "红色警戒 2");
  assert.equal(
    matchKnownGame(snapshot("mame64", "The King of Fighters '97", "D:\\Games\\KOF97")),
    "拳皇 97",
  );
  assert.equal(matchKnownGame(snapshot("mame64", "Arcade")), undefined);
  assert.equal(matchKnownGame(snapshot("StarCraft")), "星际争霸");
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

test("game detection probes shared hosts for command-line evidence without probing KK itself", () => {
  const command = buildGameDetectionProbeCommand();

  assert.equal(command.includes("MainWindowTitle"), true);
  assert.equal(command.includes("Path"), true);
  assert.equal(command.includes("CommandLine"), true);
  assert.equal(command.includes("Get-CimInstance Win32_Process"), true);
  assert.equal(command.includes("'war3'"), true);
  assert.equal(command.includes("'kk'"), false);
  assert.equal(command.includes("[Console]::OutputEncoding"), true);
  assert.equal(command.includes("UTF8Encoding"), true);
  assert.equal(command.includes("ConvertTo-Utf8Base64"), true);
  assert.equal(command.includes("MainWindowTitleBase64"), true);
  assert.equal(command.includes("ConvertTo-Json"), true);
});

test("bundled monitor artwork stays valid and newly detected games use a readable fallback", () => {
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
  assert.equal(componentSource.includes("Partial<Record<SupportedGameName"), true);
});
