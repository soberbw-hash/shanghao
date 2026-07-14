import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { GameDetectionSnapshot, RendererLogPayload } from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 8_000;

export interface ProcessSnapshot {
  ProcessName?: string;
  MainWindowTitle?: string;
  Path?: string;
}

interface GameRule {
  name: NonNullable<GameDetectionSnapshot["gameName"]>;
  processNames: string[];
  titleNeedles?: string[];
  pathNeedles?: string[];
  evidenceRequiredProcessNames?: string[];
}

const GAME_RULES: GameRule[] = [
  {
    name: "我的世界",
    processNames: ["minecraft.windows", "minecraftlauncher", "minecraft launcher", "javaw"],
    titleNeedles: ["minecraft", "我的世界"],
    pathNeedles: [".minecraft", "minecraft launcher", "minecraft\\runtime"],
    evidenceRequiredProcessNames: ["javaw"],
  },
  {
    name: "王国保卫战",
    processNames: [
      "kingdom rush",
      "kingdom rush frontiers",
      "kingdom rush origins",
      "kingdom rush vengeance",
      "kingdom rush 5 alliance",
      "kingdomrush",
    ],
  },
  { name: "杀戮尖塔", processNames: ["slaythespire"] },
  { name: "英雄联盟", processNames: ["league of legends", "leagueoflegends"] },
  { name: "无畏契约", processNames: ["valorant-win64-shipping"] },
  {
    name: "三角洲行动",
    processNames: ["deltaforce", "deltaforceclient-win64-shipping", "delta force"],
  },
  { name: "CS2", processNames: ["cs2"] },
  { name: "Dota 2", processNames: ["dota2"] },
  { name: "Apex 英雄", processNames: ["r5apex"] },
  { name: "绝地求生", processNames: ["tslgame"] },
  { name: "守望先锋", processNames: ["overwatch"] },
  { name: "永劫无间", processNames: ["narakabladepoint", "naraka"] },
  { name: "原神", processNames: ["yuanshen", "genshinimpact"] },
  { name: "崩坏：星穹铁道", processNames: ["starrail"] },
  { name: "Fortnite", processNames: ["fortniteclient-win64-shipping"] },
  { name: "GTA V", processNames: ["gta5"] },
  {
    name: "彩虹六号：围攻",
    processNames: ["rainbowsix", "rainbowsix_vulkan", "rainbowsix_be"],
  },
  {
    name: "怪物猎人",
    processNames: ["monsterhunterworld", "monsterhunterrise", "monsterhunterwilds"],
  },
  { name: "黑神话：悟空", processNames: ["b1-win64-shipping"] },
  { name: "失落城堡 2", processNames: ["lostcastle2", "lostcastle2-win64-shipping"] },
  { name: "艾尔登法环", processNames: ["eldenring"] },
  { name: "双人成行", processNames: ["ittakestwo"] },
  { name: "幻兽帕鲁", processNames: ["palworld-win64-shipping"] },
  { name: "胡闹厨房", processNames: ["overcooked2", "overcooked all you can eat"] },
  { name: "荒野大镖客 2", processNames: ["rdr2"] },
];

const normalizeProcessName = (value?: string): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "");

const parseProcessSnapshot = (raw: string): ProcessSnapshot[] => {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.filter(
      (entry): entry is ProcessSnapshot =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
  } catch {
    return [];
  }
};

const includesAny = (value: string, needles: string[] = []): boolean =>
  needles.some((needle) => value.includes(needle.toLowerCase()));

export const matchKnownGame = (
  processSnapshot: string | ProcessSnapshot[],
): GameDetectionSnapshot["gameName"] => {
  const processes = Array.isArray(processSnapshot)
    ? processSnapshot
    : parseProcessSnapshot(processSnapshot);

  for (const processInfo of processes) {
    const processName = normalizeProcessName(processInfo.ProcessName);
    const executableName = normalizeProcessName(
      processInfo.Path ? path.basename(processInfo.Path) : undefined,
    );
    const title = (processInfo.MainWindowTitle ?? "").toLowerCase();
    const processPath = (processInfo.Path ?? "").toLowerCase();

    for (const rule of GAME_RULES) {
      const processMatched = rule.processNames.some((candidate) => {
        const normalizedCandidate = normalizeProcessName(candidate);
        return processName === normalizedCandidate || executableName === normalizedCandidate;
      });
      if (!processMatched) continue;

      const requiresEvidence = rule.evidenceRequiredProcessNames?.some((candidate) => {
        const normalizedCandidate = normalizeProcessName(candidate);
        return processName === normalizedCandidate || executableName === normalizedCandidate;
      });
      if (
        requiresEvidence &&
        !includesAny(title, rule.titleNeedles) &&
        !includesAny(processPath, rule.pathNeedles)
      ) {
        continue;
      }
      return rule.name;
    }
  }
  return undefined;
};

export const buildGameDetectionProbeCommand = (): string =>
  [
    "$ErrorActionPreference='SilentlyContinue'",
    "Get-Process | ForEach-Object {",
    "  $processPath = ''",
    "  try { $processPath = $_.Path } catch {}",
    "  [PSCustomObject]@{ ProcessName=$_.ProcessName; MainWindowTitle=$_.MainWindowTitle; Path=$processPath }",
    "} | ConvertTo-Json -Compress",
  ].join("; ");

const detectKnownGame = async (): Promise<GameDetectionSnapshot["gameName"]> => {
  if (process.platform !== "win32") return undefined;

  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", buildGameDetectionProbeCommand()],
    { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 5_000 },
  ).catch(() => ({ stdout: "" }));

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
      gameName,
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
      context: { gameName },
    });
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
