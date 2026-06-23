import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GameDetectionSnapshot, RendererLogPayload } from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 4000;

const KNOWN_GAMES: Array<{ name: string; aliases: string[] }> = [
  {
    name: "失落城堡2",
    aliases: [
      "lostcastle2",
      "lost castle 2",
      "lostcastleii",
      "lost castle ii",
      "lostcastle2-win64-shipping",
      "失落城堡2",
      "失落城堡 2",
    ],
  },
  { name: "三角洲行动", aliases: ["deltaforce", "delta force"] },
  {
    name: "英雄联盟",
    aliases: [
      "leagueclient",
      "leagueclientux",
      "leagueclientuxrender",
      "league of legends",
      "league of legends.exe",
      "lolclient",
      "lol.launcher",
      "riotclientservices",
      "riot client",
      "英雄联盟",
    ],
  },
  { name: "无畏契约", aliases: ["valorant"] },
  { name: "CS2", aliases: ["cs2", "counter-strike"] },
  { name: "原神", aliases: ["genshin", "mihoyo"] },
  { name: "永劫无间", aliases: ["narakabladepoint", "nablauncher"] },
  { name: "Apex英雄", aliases: ["r5apex", "apex"] },
  { name: "绝地求生", aliases: ["tslgame", "pubg"] },
  { name: "守望先锋", aliases: ["overwatch"] },
  { name: "蛋仔派对", aliases: ["eggy"] },
  { name: "我的世界", aliases: ["minecraft", "javaw"] },
  { name: "Roblox", aliases: ["roblox"] },
];

export const buildGameDetectionProbeCommand = (): string => [
  "$ErrorActionPreference='SilentlyContinue'",
  "Get-Process | ForEach-Object {",
  "  $processPath = ''",
  "  try { $processPath = $_.Path } catch {}",
  "  [PSCustomObject]@{ ProcessName=$_.ProcessName; MainWindowTitle=$_.MainWindowTitle; Path=$processPath }",
  "} | ConvertTo-Json -Compress",
].join("; ");

export const matchKnownGame = (processSnapshot: string): GameDetectionSnapshot["gameName"] => {
  const normalized = processSnapshot.toLowerCase();
  for (const game of KNOWN_GAMES) {
    for (const alias of game.aliases) {
      if (normalized.includes(alias)) {
        return game.name as GameDetectionSnapshot["gameName"];
      }
    }
  }
  return undefined;
};

const detectKnownGame = async (): Promise<GameDetectionSnapshot["gameName"]> => {
  if (process.platform !== "win32") {
    return undefined;
  }

  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", buildGameDetectionProbeCommand()],
    { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 3000 },
  ).catch(() => {
    return { stdout: "" };
  });

  return matchKnownGame(result.stdout);
};

export class GameDetectionController {
  private timer: NodeJS.Timeout | undefined;
  private listeners = new Set<(snapshot: GameDetectionSnapshot) => void>();
  private snapshot: GameDetectionSnapshot = { checkedAt: new Date(0).toISOString() };

  constructor(private readonly writeLog: (payload: RendererLogPayload) => Promise<void>) {}

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  getSnapshot(): GameDetectionSnapshot {
    return this.snapshot;
  }

  onDetected(listener: (snapshot: GameDetectionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async check(): Promise<void> {
    const previousGame = this.snapshot.gameName;
    const gameName = await detectKnownGame();
    this.snapshot = {
      gameName: gameName,
      detectedAt: gameName
        ? previousGame === gameName
          ? this.snapshot.detectedAt
          : new Date().toISOString()
        : undefined,
      checkedAt: new Date().toISOString(),
    };

    if (previousGame === gameName) return;
    await this.writeLog({
      category: "app",
      level: "info",
      message: gameName ? "Known game detected" : "Known game no longer detected",
      context: { gameName: gameName },
    });
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}
