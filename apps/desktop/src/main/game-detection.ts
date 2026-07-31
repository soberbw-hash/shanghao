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
  CommandLine?: string;
}

interface GameRule {
  name: NonNullable<GameDetectionSnapshot["gameName"]>;
  processNames: string[];
  titleNeedles?: string[];
  pathNeedles?: string[];
  commandLineNeedles?: string[];
  evidenceRequiredProcessNames?: string[];
}

const KK_SHARED_GAME_HOSTS = [
  "war3",
  "war3n",
  "warcraft iii",
  "warcraft_iii",
  "y3",
  "y3game",
  "game",
  "game_x64h",
];

const GAME_RULES: GameRule[] = [
  {
    name: "向魔兽开炮",
    processNames: KK_SHARED_GAME_HOSTS,
    titleNeedles: ["向魔兽开炮", "205715"],
    pathNeedles: ["向魔兽开炮", "205715"],
    commandLineNeedles: ["向魔兽开炮", "205715"],
    evidenceRequiredProcessNames: KK_SHARED_GAME_HOSTS,
  },
  {
    name: "尸潮庇护所",
    processNames: KK_SHARED_GAME_HOSTS,
    titleNeedles: ["尸潮庇护所", "最后的避难所3", "最后的避难所 3", "199168"],
    pathNeedles: ["尸潮庇护所", "最后的避难所3", "最后的避难所 3", "199168"],
    commandLineNeedles: ["尸潮庇护所", "最后的避难所3", "最后的避难所 3", "199168"],
    evidenceRequiredProcessNames: KK_SHARED_GAME_HOSTS,
  },
  {
    name: "DotA 1",
    processNames: ["war3", "war3n", "warcraft iii", "warcraft_iii"],
    titleNeedles: ["dota allstars", "dota 1", "dota1"],
    pathNeedles: ["dota allstars", "dota1"],
    commandLineNeedles: ["dota allstars", "dota 1", "dota1"],
    evidenceRequiredProcessNames: ["war3", "war3n", "warcraft iii", "warcraft_iii"],
  },
  {
    name: "魔兽争霸 3",
    processNames: ["war3", "war3n", "warcraft iii", "warcraft_iii"],
  },
  {
    name: "KK RPG",
    processNames: ["game_x64h"],
  },
  {
    name: "CS 1.6",
    processNames: ["hl", "cstrike", "cs16"],
    titleNeedles: ["counter-strike", "反恐精英", "cs 1.6", "cs1.6"],
    pathNeedles: ["counter-strike", "cstrike", "cs1.6"],
    commandLineNeedles: ["-game cstrike", "counter-strike", "cs1.6"],
    evidenceRequiredProcessNames: ["hl"],
  },
  {
    name: "红色警戒 2",
    processNames: ["gamemd", "ra2", "ra2md", "redalert2"],
  },
  {
    name: "拳皇 97",
    processNames: ["kkemulator", "mame32", "mame64", "winkawaks", "kawaks"],
    titleNeedles: ["拳皇", "kof97", "king of fighters"],
    pathNeedles: ["kof97", "king of fighters"],
    commandLineNeedles: ["kof97", "king of fighters"],
    evidenceRequiredProcessNames: ["kkemulator", "mame32", "mame64", "winkawaks", "kawaks"],
  },
  {
    name: "星际争霸",
    processNames: ["starcraft", "starcraft remastered", "starcraftremastered"],
  },
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
  { name: "穿越火线", processNames: ["crossfire", "crossfire_cn", "crossfire64"] },
  { name: "地下城与勇士", processNames: ["dnf", "dnfchina", "dnfmain"] },
  {
    name: "魔兽世界",
    processNames: ["wow", "wowclassic", "wowclassicera", "wowclassic_t"],
  },
  { name: "炉石传说", processNames: ["hearthstone"] },
  { name: "燕云十六声", processNames: ["wherewindsmeet", "where winds meet"] },
  {
    name: "鸣潮",
    processNames: ["wutheringwaves", "wuthering waves", "wutheringwaves-win64-shipping"],
  },
  { name: "绝区零", processNames: ["zenlesszonezero", "zenless zone zero"] },
  {
    name: "暗区突围：无限",
    processNames: ["uagame", "uagame-win64-shipping", "arenabreakoutinfinite"],
  },
  { name: "逃离塔科夫", processNames: ["escapefromtarkov"] },
  {
    name: "极限竞速：地平线 5",
    processNames: ["forzahorizon5", "forza horizon 5"],
  },
  { name: "赛博朋克 2077", processNames: ["cyberpunk2077"] },
  { name: "巫师 3", processNames: ["witcher3"] },
  {
    name: "战地风云",
    processNames: ["bf1", "bfv", "bf2042", "battlefield2042", "battlefield 2042"],
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
    const commandLine = (processInfo.CommandLine ?? "").toLowerCase();

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
        !includesAny(processPath, rule.pathNeedles) &&
        !includesAny(commandLine, rule.commandLineNeedles)
      ) {
        continue;
      }
      return rule.name;
    }
  }
  return undefined;
};

export const buildGameDetectionProbeCommand = (): string => {
  const commandLineProcessNames = Array.from(
    new Set(
      GAME_RULES.flatMap((rule) => rule.evidenceRequiredProcessNames ?? []).map(
        normalizeProcessName,
      ),
    ),
  );
  const processNameArray = commandLineProcessNames
    .map((processName) => `'${processName.replace(/'/g, "''")}'`)
    .join(",");

  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$commandLineProcessNames=@(${processNameArray})`,
    "Get-Process | ForEach-Object {",
    "  $processPath = ''",
    "  $commandLine = ''",
    "  try { $processPath = $_.Path } catch {}",
    "  if ($commandLineProcessNames -contains $_.ProcessName.ToLowerInvariant()) {",
    '    try { $processDetails = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)"; $commandLine = $processDetails.CommandLine; if (-not $processPath) { $processPath = $processDetails.ExecutablePath } } catch {}',
    "  }",
    "  [PSCustomObject]@{ ProcessName=$_.ProcessName; MainWindowTitle=$_.MainWindowTitle; Path=$processPath; CommandLine=$commandLine }",
    "} | ConvertTo-Json -Compress",
  ].join("; ");
};

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
  private enabled = false;
  private checkInFlight = false;
  private listeners = new Set<(snapshot: GameDetectionSnapshot) => void>();
  private snapshot: GameDetectionSnapshot = { checkedAt: new Date(0).toISOString() };

  constructor(private readonly writeLog: (payload: RendererLogPayload) => Promise<void>) {}

  start(): void {
    void this.setEnabled(true);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled) return;
    this.enabled = enabled;

    if (!enabled) {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.snapshot = { checkedAt: new Date().toISOString() };
      for (const listener of this.listeners) listener(this.snapshot);
      await this.writeLog({
        category: "app",
        level: "info",
        message: "game_detection_disabled",
      });
      return;
    }

    await this.writeLog({
      category: "app",
      level: "info",
      message: "game_detection_enabled",
    });
    void this.check();
    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.enabled = false;
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
    if (!this.enabled || this.checkInFlight) return;
    this.checkInFlight = true;
    const previousGame = this.snapshot.gameName;
    const gameName = await detectKnownGame().finally(() => {
      this.checkInFlight = false;
    });
    if (!this.enabled) return;
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
