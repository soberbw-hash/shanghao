import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GameDetectionSnapshot, RendererLogPayload } from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 4_000;

export const matchKnownGame = (processNames: string): GameDetectionSnapshot["gameName"] => {
  const normalized = processNames.toLowerCase();
  if (normalized.includes("deltaforce")) {
    return "三角洲行动";
  }
  if (normalized.includes("leagueclient") || normalized.includes("league of legends")) {
    return "英雄联盟";
  }
  return undefined;
};

const detectKnownGame = async (): Promise<GameDetectionSnapshot["gameName"]> => {
  if (process.platform !== "win32") {
    return undefined;
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='SilentlyContinue'; Get-Process -Name DeltaForce,LeagueClient,'League of Legends' | Select-Object -ExpandProperty ProcessName",
    ],
    { windowsHide: true, timeout: 2_500 },
  ).catch(() => ({ stdout: "" }));

  return matchKnownGame(stdout);
};

export class GameDetectionController {
  private timer?: NodeJS.Timeout;
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
      gameName,
      detectedAt:
        gameName
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
      context: { gameName },
    });
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
