import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GameDetectionSnapshot, RendererLogPayload } from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 4000;

const KNOWN_GAMES: Array<{ name: string; processNames: string[] }> = [
  { name: "失落城堡2", processNames: ["lostcastle2", "lost castle 2", "lostcastleii", "lost castle ii"] },
  { name: "三角洲行动", processNames: ["deltaforce", "delta force"] },
  {
    name: "英雄联盟",
    processNames: [
      "leagueclient",
      "leagueclientux",
      "leagueclientuxrender",
      "league of legends",
      "riotclientservices",
    ],
  },
  { name: "无畏契约", processNames: ["valorant"] },
  { name: "CS2", processNames: ["cs2", "counter-strike"] },
  { name: "原神", processNames: ["genshin", "mihoyo"] },
  { name: "永劫无间", processNames: ["narakabladepoint", "nablauncher"] },
  { name: "Apex英雄", processNames: ["r5apex", "apex"] },
  { name: "绝地求生", processNames: ["tslgame", "pubg"] },
  { name: "守望先锋", processNames: ["overwatch"] },
  { name: "蛋仔派对", processNames: ["eggy"] },
  { name: "我的世界", processNames: ["minecraft", "javaw"] },
  { name: "Roblox", processNames: ["roblox"] },
];

export const matchKnownGame = (processNames: string): GameDetectionSnapshot["gameName"] => {
  const normalized = processNames.toLowerCase();
  for (const game of KNOWN_GAMES) {
    for (const pn of game.processNames) {
      if (normalized.includes(pn)) {
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

  const gameNames = KNOWN_GAMES.flatMap(function (g) {
    return g.processNames.map(function (p) {
      return "'" + p + "'";
    });
  }).join(",");

  var cmd = "$ErrorActionPreference='SilentlyContinue'; Get-Process -Name " + gameNames + " -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName";

  var result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", cmd],
    { windowsHide: true, timeout: 2500 },
  ).catch(function () {
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
