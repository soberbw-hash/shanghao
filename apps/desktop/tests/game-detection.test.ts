import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildGameDetectionProbeCommand,
  buildMediaSessionProbeCommand,
  matchKnownGame,
  matchKnownWorkActivity,
  matchMediaSessionMusicActivity,
  matchMusicActivity,
  resolveStableMusicActivity,
  SUPPORTED_GAME_NAMES,
  WORK_ACTIVITY_RULES,
} from "../src/main/game-detection";

const snapshot = (
  ProcessName: string,
  MainWindowTitle = "",
  Path = "",
  CommandLine = "",
  IsForeground?: boolean,
): string => JSON.stringify({ ProcessName, MainWindowTitle, Path, CommandLine, IsForeground });

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

test("Tencent PC additions and Lost Control Evolution are detected by exact executable", () => {
  assert.equal(matchKnownGame(snapshot("Evolution-Win64-Shipping")), "失控进化");
  assert.equal(matchKnownGame(snapshot("NZFuture-Win64-Shipping")), "逆战：未来");
  assert.equal(matchKnownGame(snapshot("RocoKingdomWorld")), "洛克王国：世界");
  assert.equal(matchKnownGame(snapshot("AnimulaNook")), "粒粒的小人国");
  assert.equal(SUPPORTED_GAME_NAMES.includes("王者荣耀世界"), true);
  assert.equal(SUPPORTED_GAME_NAMES.includes("暗区突围：无限"), true);
});

test("work activity is private to the foreground app and covers common creator tools", () => {
  assert.deepEqual(matchKnownWorkActivity(snapshot("Code", "", "", "", true)), {
    id: "vscode",
    name: "Visual Studio Code",
    category: "development",
  });
  assert.deepEqual(matchKnownWorkActivity(snapshot("Photoshop", "", "", "", true)), {
    id: "photoshop",
    name: "Photoshop",
    category: "design",
  });
  assert.deepEqual(matchKnownWorkActivity(snapshot("MATLAB", "", "", "", true)), {
    id: "matlab",
    name: "MATLAB",
    category: "data",
  });
  assert.deepEqual(matchKnownWorkActivity(snapshot("pythonw", "", "", "", true)), {
    id: "python",
    name: "Python",
    category: "development",
  });
  assert.equal(matchKnownWorkActivity(snapshot("Code", "", "", "", false)), undefined);
  assert.deepEqual(
    matchKnownWorkActivity(
      snapshot(
        "ChatGPT",
        "ChatGPT",
        "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.803.10989.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe",
        "",
        true,
      ),
    ),
    { id: "codex", name: "Codex", category: "development" },
  );
  assert.equal(
    matchKnownWorkActivity(
      snapshot(
        "ChatGPT",
        "ChatGPT",
        "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.0.0.0_x64__test\\app\\ChatGPT.exe",
        "",
        false,
      ),
    ),
    undefined,
  );
});

test("Codex work detection keeps the official Appx manifest path as its identity evidence", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/main/game-detection.ts"), "utf8");
  assert.equal(source.includes("AppxManifest.xml"), true);
  assert.equal(source.includes("Square44x44Logo"), true);
  assert.equal(source.includes("targetsize-64_altform-unplated"), true);
  assert.equal(source.includes('activityId === "codex"'), true);
});

test("repository documentation lists every supported game and work application", () => {
  const documentation = readFileSync(
    path.resolve(process.cwd(), "../../docs/supported-activities.md"),
    "utf8",
  );
  assert.equal(SUPPORTED_GAME_NAMES.length, 49);
  assert.equal(WORK_ACTIVITY_RULES.length, 62);
  for (const gameName of SUPPORTED_GAME_NAMES) {
    assert.equal(
      documentation.includes(gameName),
      true,
      `${gameName} is missing from documentation`,
    );
  }
  for (const work of WORK_ACTIVITY_RULES) {
    assert.equal(
      documentation.includes(work.name),
      true,
      `${work.name} is missing from documentation`,
    );
  }
});

test("Apple Music Store metadata comes from the Windows media session", () => {
  assert.deepEqual(
    matchMediaSessionMusicActivity([
      {
        SourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
        Title: "Exchange",
        Artist: "Bryson Tiller — T R A P S O U L (Deluxe)",
        PlaybackStatus: "Playing",
      },
    ]),
    {
      provider: "applemusic",
      providerName: "Apple Music",
      trackTitle: "Exchange",
      artist: "Bryson Tiller",
    },
  );
  assert.equal(
    matchMediaSessionMusicActivity([
      {
        SourceAppUserModelId: "AppleInc.AppleMusicWin_nzyj5cx40ttqa!App",
        Title: "Exchange",
        Artist: "Bryson Tiller",
        PlaybackStatus: "Paused",
      },
    ]),
    undefined,
  );

  const command = buildMediaSessionProbeCommand();
  assert.equal(command.includes("GlobalSystemMediaTransportControlsSessionManager"), true);
  assert.equal(command.includes("TryGetMediaPropertiesAsync"), true);
  assert.equal(command.includes("SourceAppUserModelId"), true);
  assert.equal(command.includes("PlaybackStatus"), true);
  assert.equal(command.includes("TitleBase64"), true);
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
  assert.deepEqual(
    matchMusicActivity(snapshot("AppleMusic", "Bad Guy - Billie Eilish - Apple Music")),
    {
      provider: "applemusic",
      providerName: "Apple Music",
      trackTitle: "Bad Guy",
      artist: "Billie Eilish",
    },
  );
  assert.deepEqual(
    matchMusicActivity(
      snapshot("ApplicationFrameHost", "Blinding Lights - The Weeknd - Apple Music"),
    ),
    {
      provider: "applemusic",
      providerName: "Apple Music",
      trackTitle: "Blinding Lights",
      artist: "The Weeknd",
    },
  );
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

test("KK launcher alone stays hidden while a real foreground hosted process reports KK", () => {
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
  assert.equal(
    matchKnownGame([
      JSON.parse(snapshot("KK", "KK 对战平台", "C:\\Program Files\\KK\\KK.exe", "", false)),
      JSON.parse(snapshot("DeltaForceClient-Win64-Shipping", "", "", "", true)),
    ]),
    "三角洲行动",
  );
  assert.equal(
    matchKnownGame(
      snapshot(
        "Game_x64h",
        "英雄三国",
        "C:\\Program Files (x86)\\kkduizhan\\Games\\Hero\\Game_x64h.exe",
        "",
        true,
      ),
    ),
    "KK 对战平台",
  );
  assert.equal(
    matchKnownGame(
      snapshot(
        "Game_x64h",
        "英雄三国",
        "C:\\Program Files (x86)\\kkduizhan\\Games\\Hero\\Game_x64h.exe",
        "",
        false,
      ),
    ),
    undefined,
  );
  assert.equal(matchKnownGame(snapshot("Game_x64h", "KK RPG")), undefined);
  assert.equal(matchKnownGame(snapshot("war3", "Warcraft III")), undefined);
  assert.equal(matchKnownGame(snapshot("game", "普通应用")), undefined);
});

test("KK hosted and classic game processes are no longer reported separately", () => {
  assert.equal(matchKnownGame(snapshot("hl", "Half-Life SDK")), undefined);
  assert.equal(matchKnownGame(snapshot("gamemd")), undefined);
  assert.equal(matchKnownGame(snapshot("mame64", "Arcade")), undefined);
  assert.equal(matchKnownGame(snapshot("StarCraft")), undefined);
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

test("game detection resolves the foreground PID and probes KK hosted process evidence", () => {
  const command = buildGameDetectionProbeCommand();

  assert.equal(command.includes("MainWindowTitle"), true);
  assert.equal(command.includes("IsForeground"), true);
  assert.equal(command.includes("Path"), true);
  assert.equal(command.includes("CommandLine"), true);
  assert.equal(command.includes("Get-CimInstance Win32_Process"), true);
  assert.equal(command.includes("'war3'"), true);
  assert.equal(command.includes("'platform'"), false);
  assert.equal(command.includes("GetWindowThreadProcessId"), true);
  assert.equal(command.includes("$foregroundProcessId"), true);
  assert.equal(command.includes("[Console]::OutputEncoding"), true);
  assert.equal(command.includes("UTF8Encoding"), true);
  assert.equal(command.includes("ConvertTo-Utf8Base64"), true);
  assert.equal(command.includes("MainWindowTitleBase64"), true);
  assert.equal(command.includes("ConvertTo-Json"), true);
});

test("bundled monitor artwork stays valid and newly detected games use a readable fallback", () => {
  const detectorSource = readFileSync(
    path.resolve(process.cwd(), "src/main/game-detection.ts"),
    "utf8",
  );
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

  assert.equal(componentSource.includes('artwork?.layout ?? "fallback"'), true);
  assert.equal(componentSource.includes("Partial<Record<SupportedGameName"), true);
  assert.equal(componentSource.includes("scene-game-monitor-label"), false);
  assert.equal(
    componentSource.indexOf("iconDataUrl ? (") < componentSource.indexOf(") : artwork ? ("),
    true,
  );
  assert.equal(componentSource.includes("data-game-scan"), true);
  assert.equal(componentSource.includes("shouldReduceMotion"), true);
  assert.equal(detectorSource.includes('getFileIcon(executablePath, { size: "large" })'), true);
  assert.equal(detectorSource.includes('resize({ width: 64, height: 64, quality: "best" })'), true);
});
