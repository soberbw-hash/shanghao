import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { app, nativeImage } from "electron";

import type {
  GameDetectionSnapshot,
  MusicActivity,
  MusicProviderId,
  RendererLogPayload,
  WorkActivity,
} from "@private-voice/shared";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 8_000;
const MUSIC_ACTIVITY_MISS_TOLERANCE = 3;
const WORK_ACTIVITY_MISS_TOLERANCE = 1;
const MAX_ACTIVITY_ICON_DATA_URL_LENGTH = 48_000;

export interface ProcessSnapshot {
  ProcessName?: string;
  MainWindowTitle?: string;
  Path?: string;
  CommandLine?: string;
  MainWindowTitleBase64?: string;
  PathBase64?: string;
  CommandLineBase64?: string;
  IsForeground?: boolean;
}

export interface MediaSessionSnapshot {
  SourceAppUserModelId?: string;
  Title?: string;
  Artist?: string;
  PlaybackStatus?: string;
  TitleBase64?: string;
  ArtistBase64?: string;
}

interface GameRule {
  name: NonNullable<GameDetectionSnapshot["gameName"]>;
  processNames: string[];
  titleNeedles?: string[];
  pathNeedles?: string[];
  commandLineNeedles?: string[];
  evidenceRequiredProcessNames?: string[];
}

interface MusicRule {
  provider: MusicProviderId;
  providerName: string;
  processNames: string[];
  genericTitles: string[];
}

interface WorkRule extends Omit<WorkActivity, "iconDataUrl"> {
  processNames: string[];
}

interface MatchedActivity<T> {
  activity: T;
  executablePath?: string;
}

const MUSIC_RULES: MusicRule[] = [
  {
    provider: "spotify",
    providerName: "Spotify",
    processNames: ["spotify"],
    genericTitles: ["spotify", "spotify premium"],
  },
  {
    provider: "netease",
    providerName: "网易云音乐",
    processNames: ["cloudmusic", "orpheus"],
    genericTitles: ["网易云音乐", "cloudmusic"],
  },
  {
    provider: "qqmusic",
    providerName: "QQ 音乐",
    processNames: ["qqmusic"],
    genericTitles: ["qq音乐", "qq music", "qqmusic"],
  },
  {
    provider: "applemusic",
    providerName: "Apple Music",
    processNames: ["applemusic", "applemusicpreview", "itunes"],
    genericTitles: ["apple music", "itunes"],
  },
];

export const WORK_ACTIVITY_RULES: WorkRule[] = [
  { id: "codex", name: "Codex", category: "development", processNames: ["codex"] },
  { id: "workbuddy", name: "WorkBuddy", category: "development", processNames: ["workbuddy"] },
  { id: "vscode", name: "Visual Studio Code", category: "development", processNames: ["code"] },
  { id: "cursor", name: "Cursor", category: "development", processNames: ["cursor"] },
  { id: "trae", name: "Trae", category: "development", processNames: ["trae"] },
  { id: "visual-studio", name: "Visual Studio", category: "development", processNames: ["devenv"] },
  {
    id: "intellij",
    name: "IntelliJ IDEA",
    category: "development",
    processNames: ["idea64", "idea"],
  },
  {
    id: "pycharm",
    name: "PyCharm",
    category: "development",
    processNames: ["pycharm64", "pycharm"],
  },
  {
    id: "webstorm",
    name: "WebStorm",
    category: "development",
    processNames: ["webstorm64", "webstorm"],
  },
  { id: "clion", name: "CLion", category: "development", processNames: ["clion64", "clion"] },
  { id: "rider", name: "Rider", category: "development", processNames: ["rider64", "rider"] },
  { id: "goland", name: "GoLand", category: "development", processNames: ["goland64", "goland"] },
  {
    id: "android-studio",
    name: "Android Studio",
    category: "development",
    processNames: ["studio64", "studio"],
  },
  {
    id: "github-desktop",
    name: "GitHub Desktop",
    category: "development",
    processNames: ["githubdesktop"],
  },
  { id: "postman", name: "Postman", category: "development", processNames: ["postman"] },
  {
    id: "docker",
    name: "Docker Desktop",
    category: "development",
    processNames: ["docker desktop"],
  },
  {
    id: "python",
    name: "Python",
    category: "development",
    processNames: ["python", "pythonw", "idle"],
  },
  { id: "java", name: "Java", category: "development", processNames: ["java", "javaw"] },
  { id: "eclipse", name: "Eclipse", category: "development", processNames: ["eclipse"] },
  {
    id: "netbeans",
    name: "NetBeans",
    category: "development",
    processNames: ["netbeans", "netbeans64"],
  },
  { id: "rstudio", name: "RStudio", category: "data", processNames: ["rstudio"] },
  {
    id: "anaconda",
    name: "Anaconda Navigator",
    category: "data",
    processNames: ["anaconda-navigator"],
  },
  { id: "photoshop", name: "Photoshop", category: "design", processNames: ["photoshop"] },
  { id: "illustrator", name: "Illustrator", category: "design", processNames: ["illustrator"] },
  { id: "figma", name: "Figma", category: "design", processNames: ["figma"] },
  { id: "indesign", name: "InDesign", category: "design", processNames: ["indesign"] },
  { id: "premiere", name: "Premiere Pro", category: "media", processNames: ["adobe premiere pro"] },
  { id: "after-effects", name: "After Effects", category: "media", processNames: ["afterfx"] },
  { id: "audition", name: "Adobe Audition", category: "media", processNames: ["adobe audition"] },
  {
    id: "media-encoder",
    name: "Media Encoder",
    category: "media",
    processNames: ["adobe media encoder"],
  },
  { id: "davinci", name: "DaVinci Resolve", category: "media", processNames: ["resolve"] },
  { id: "blender", name: "Blender", category: "design", processNames: ["blender"] },
  { id: "unity", name: "Unity", category: "development", processNames: ["unity"] },
  {
    id: "unreal",
    name: "Unreal Editor",
    category: "development",
    processNames: ["unrealeditor", "ue4editor"],
  },
  { id: "maya", name: "Maya", category: "design", processNames: ["maya"] },
  { id: "3ds-max", name: "3ds Max", category: "design", processNames: ["3dsmax"] },
  { id: "sketchup", name: "SketchUp", category: "engineering", processNames: ["sketchup"] },
  { id: "autocad", name: "AutoCAD", category: "engineering", processNames: ["acad"] },
  { id: "solidworks", name: "SOLIDWORKS", category: "engineering", processNames: ["sldworks"] },
  { id: "revit", name: "Revit", category: "engineering", processNames: ["revit"] },
  { id: "fusion-360", name: "Fusion 360", category: "engineering", processNames: ["fusion360"] },
  { id: "catia", name: "CATIA", category: "engineering", processNames: ["cnext"] },
  { id: "siemens-nx", name: "Siemens NX", category: "engineering", processNames: ["ugraf"] },
  { id: "matlab", name: "MATLAB", category: "data", processNames: ["matlab"] },
  { id: "labview", name: "LabVIEW", category: "engineering", processNames: ["labview"] },
  { id: "ansys", name: "ANSYS", category: "engineering", processNames: ["ansys", "runwb2"] },
  { id: "altium", name: "Altium Designer", category: "engineering", processNames: ["x2"] },
  { id: "proteus", name: "Proteus", category: "engineering", processNames: ["pds"] },
  { id: "keil", name: "Keil", category: "engineering", processNames: ["uv4", "uv5"] },
  {
    id: "stm32cubeide",
    name: "STM32CubeIDE",
    category: "engineering",
    processNames: ["stm32cubeide"],
  },
  {
    id: "arduino",
    name: "Arduino IDE",
    category: "engineering",
    processNames: ["arduino ide", "arduino"],
  },
  { id: "word", name: "Word", category: "office", processNames: ["winword"] },
  { id: "excel", name: "Excel", category: "office", processNames: ["excel"] },
  { id: "powerpoint", name: "PowerPoint", category: "office", processNames: ["powerpnt"] },
  { id: "visio", name: "Visio", category: "office", processNames: ["visio"] },
  { id: "power-bi", name: "Power BI", category: "data", processNames: ["pbidesktop"] },
  { id: "tableau", name: "Tableau", category: "data", processNames: ["tableau"] },
  { id: "origin", name: "Origin", category: "data", processNames: ["origin", "originpro"] },
  { id: "spss", name: "SPSS Statistics", category: "data", processNames: ["stats"] },
  { id: "wps", name: "WPS Office", category: "office", processNames: ["wps", "et", "wpp"] },
  { id: "notion", name: "Notion", category: "office", processNames: ["notion"] },
  { id: "obsidian", name: "Obsidian", category: "office", processNames: ["obsidian"] },
];

const KK_PLATFORM_GAME_NAME: NonNullable<GameDetectionSnapshot["gameName"]> = "KK 对战平台";
const KK_HOSTED_PROCESS_NAMES = ["game_x64h", "war3", "war3n", "warcraft iii", "warcraft_iii"];
const KK_LAUNCHER_PROCESS_NAMES = new Set(["kk", "kkgamebox", "platform"]);
const KK_PATH_NEEDLES = ["kkduizhan", "\\kk\\", "\\kkgame\\", "\\games\\y3\\"];

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
  {
    name: "失控进化",
    processNames: ["lostcontrolevolution", "outofcontrolevolution", "evolution-win64-shipping"],
    titleNeedles: ["失控进化"],
    pathNeedles: ["失控进化", "lostcontrolevolution"],
  },
  { name: "逆战：未来", processNames: ["nzfuture", "nzmobile", "nzfuture-win64-shipping"] },
  { name: "王者荣耀世界", processNames: ["hokworld", "honorofkingsworld", "world-win64-shipping"] },
  { name: "异人之下", processNames: ["thehiddenones", "yirenzhixia", "underoneperson"] },
  { name: "命运方舟", processNames: ["lostark", "lostarkclient", "lostarkclient-win64-shipping"] },
  {
    name: "塔瑞斯世界",
    processNames: ["tarisland", "tarislandclient", "tarisland-win64-shipping"],
  },
  { name: "剑灵 2", processNames: ["bns2", "bladeandsoul2", "bns2-win64-shipping"] },
  { name: "终极角逐", processNames: ["discovery", "thefinals", "discovery-win64-shipping"] },
  {
    name: "洛克王国：世界",
    processNames: ["rocokingdomworld", "roco kingdom world", "rkworld-win64-shipping"],
  },
  { name: "粒粒的小人国", processNames: ["animulanook", "animula nook", "animula-win64-shipping"] },
  { name: "黑神话：悟空", processNames: ["b1-win64-shipping"] },
  { name: "失落城堡 2", processNames: ["lostcastle2", "lostcastle2-win64-shipping"] },
  { name: "艾尔登法环", processNames: ["eldenring"] },
  { name: "双人成行", processNames: ["ittakestwo"] },
  { name: "幻兽帕鲁", processNames: ["palworld-win64-shipping"] },
  { name: "胡闹厨房", processNames: ["overcooked2", "overcooked all you can eat"] },
  { name: "荒野大镖客 2", processNames: ["rdr2"] },
  {
    name: KK_PLATFORM_GAME_NAME,
    processNames: KK_HOSTED_PROCESS_NAMES,
    titleNeedles: ["kk rpg", "kkrpg", "kk 对战平台", "kk官方对战平台"],
    pathNeedles: KK_PATH_NEEDLES,
    commandLineNeedles: KK_PATH_NEEDLES,
    evidenceRequiredProcessNames: ["war3", "war3n", "warcraft iii", "warcraft_iii"],
  },
];

export const SUPPORTED_GAME_NAMES = GAME_RULES.map((rule) => rule.name);

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
    return entries
      .filter(
        (entry): entry is ProcessSnapshot =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
      .map((entry) => ({
        ...entry,
        MainWindowTitle: decodeUtf8Base64(entry.MainWindowTitleBase64) ?? entry.MainWindowTitle,
        Path: decodeUtf8Base64(entry.PathBase64) ?? entry.Path,
        CommandLine: decodeUtf8Base64(entry.CommandLineBase64) ?? entry.CommandLine,
      }));
  } catch {
    return [];
  }
};

const parseMediaSessionSnapshot = (raw: string): MediaSessionSnapshot[] => {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries
      .filter(
        (entry): entry is MediaSessionSnapshot =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
      .map((entry) => ({
        ...entry,
        Title: decodeUtf8Base64(entry.TitleBase64) ?? entry.Title,
        Artist: decodeUtf8Base64(entry.ArtistBase64) ?? entry.Artist,
      }));
  } catch {
    return [];
  }
};

const decodeUtf8Base64 = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return undefined;
  }
};

const includesAny = (value: string, needles: string[] = []): boolean =>
  needles.some((needle) => value.includes(needle.toLowerCase()));

const isKkHostedGameProcess = (processInfo: ProcessSnapshot): boolean => {
  const processName = normalizeProcessName(processInfo.ProcessName);
  const executableName = normalizeProcessName(
    processInfo.Path ? path.basename(processInfo.Path) : undefined,
  );
  const identity = processName || executableName;
  if (identity === "game_x64h") return true;
  if (KK_LAUNCHER_PROCESS_NAMES.has(identity)) return false;

  const evidence = `${processInfo.MainWindowTitle ?? ""}\n${processInfo.Path ?? ""}\n${
    processInfo.CommandLine ?? ""
  }`
    .toLowerCase()
    .replaceAll("/", "\\");
  const hasKkEvidence = includesAny(evidence, [
    ...KK_PATH_NEEDLES,
    "kk rpg",
    "kkrpg",
    "kk 对战平台",
    "kk官方对战平台",
  ]);
  if (!hasKkEvidence) return false;

  const isKnownHostedProcess = KK_HOSTED_PROCESS_NAMES.some(
    (candidate) => normalizeProcessName(candidate) === identity,
  );
  return isKnownHostedProcess || evidence.includes("\\games\\");
};

const selectForegroundActivityProcesses = (processes: ProcessSnapshot[]): ProcessSnapshot[] => {
  const hasForegroundMetadata = processes.some(
    (processInfo) => typeof processInfo.IsForeground === "boolean",
  );
  return hasForegroundMetadata
    ? processes.filter((processInfo) => processInfo.IsForeground === true)
    : processes;
};

export const matchKnownGame = (
  processSnapshot: string | ProcessSnapshot[],
): GameDetectionSnapshot["gameName"] => {
  const processes = Array.isArray(processSnapshot)
    ? processSnapshot
    : parseProcessSnapshot(processSnapshot);
  const foregroundProcesses = selectForegroundActivityProcesses(processes);

  if (foregroundProcesses.some(isKkHostedGameProcess)) return KK_PLATFORM_GAME_NAME;

  for (const rule of GAME_RULES) {
    for (const processInfo of foregroundProcesses) {
      const processName = normalizeProcessName(processInfo.ProcessName);
      const executableName = normalizeProcessName(
        processInfo.Path ? path.basename(processInfo.Path) : undefined,
      );
      const title = (processInfo.MainWindowTitle ?? "").toLowerCase();
      const processPath = (processInfo.Path ?? "").toLowerCase();
      const commandLine = (processInfo.CommandLine ?? "").toLowerCase();

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

const matchKnownGameActivity = (
  processes: ProcessSnapshot[],
): MatchedActivity<NonNullable<GameDetectionSnapshot["gameName"]>> | undefined => {
  const foregroundProcesses = selectForegroundActivityProcesses(processes);
  const gameName = matchKnownGame(foregroundProcesses);
  if (!gameName) return undefined;
  const rule = GAME_RULES.find((candidate) => candidate.name === gameName);
  if (!rule) return { activity: gameName };
  // KK hosts many games inside its own process tree. Exposing the hosted
  // executable icon would leak the concrete game (for example 英雄三国) even
  // though the public activity is intentionally unified as KK 对战平台.
  if (gameName === KK_PLATFORM_GAME_NAME) return { activity: gameName };
  for (const processInfo of foregroundProcesses) {
    const processName = normalizeProcessName(processInfo.ProcessName);
    const executableName = normalizeProcessName(
      processInfo.Path ? path.basename(processInfo.Path) : undefined,
    );
    if (
      rule.processNames.some((candidate) => {
        const normalizedCandidate = normalizeProcessName(candidate);
        return processName === normalizedCandidate || executableName === normalizedCandidate;
      })
    ) {
      return { activity: gameName, executablePath: processInfo.Path };
    }
  }
  return { activity: gameName };
};

const matchKnownWorkActivityWithProcess = (
  processes: ProcessSnapshot[],
): MatchedActivity<WorkActivity> | undefined => {
  const visibleProcesses = selectForegroundActivityProcesses(processes);

  for (const processInfo of visibleProcesses) {
    const processName = normalizeProcessName(processInfo.ProcessName);
    const executableName = normalizeProcessName(
      processInfo.Path ? path.basename(processInfo.Path) : undefined,
    );
    const normalizedEvidence = `${processInfo.Path ?? ""}\n${processInfo.CommandLine ?? ""}`
      .toLocaleLowerCase()
      .replaceAll("/", "\\");
    const rule = WORK_ACTIVITY_RULES.find((candidate) => {
      const isDirectProcessMatch = candidate.processNames.some((name) => {
        const normalized = normalizeProcessName(name);
        return normalized === processName || normalized === executableName;
      });
      if (isDirectProcessMatch) return true;

      return (
        candidate.id === "codex" &&
        (processName === "chatgpt" || executableName === "chatgpt") &&
        (normalizedEvidence.includes("openai.codex_") ||
          normalizedEvidence.includes("\\roaming\\codex\\"))
      );
    });
    if (!rule) continue;
    return {
      activity: { id: rule.id, name: rule.name, category: rule.category },
      executablePath: processInfo.Path,
    };
  }
  return undefined;
};

export const matchKnownWorkActivity = (
  processSnapshot: string | ProcessSnapshot[],
): WorkActivity | undefined => {
  const processes = Array.isArray(processSnapshot)
    ? processSnapshot
    : parseProcessSnapshot(processSnapshot);
  return matchKnownWorkActivityWithProcess(processes)?.activity;
};

const loadCodexManifestIcon = async (executablePath: string): Promise<string | undefined> => {
  const normalizedPath = executablePath.toLocaleLowerCase().replaceAll("/", "\\");
  if (!normalizedPath.includes("\\windowsapps\\openai.codex_")) return undefined;

  try {
    const packageRoot = path.dirname(path.dirname(executablePath));
    const manifest = await readFile(path.join(packageRoot, "AppxManifest.xml"), "utf8");
    const manifestLogo =
      manifest.match(/Square44x44Logo="([^"]+)"/i)?.[1] ??
      manifest.match(/<Logo>([^<]+)<\/Logo>/i)?.[1];
    if (!manifestLogo) return undefined;

    const relativeLogo = manifestLogo.replaceAll("/", path.sep).replaceAll("\\", path.sep);
    const exactLogoPath = path.join(packageRoot, relativeLogo);
    const parsedLogo = path.parse(exactLogoPath);
    const siblingNames = await readdir(parsedLogo.dir).catch(() => [] as string[]);
    const preferredName = siblingNames.find(
      (name) =>
        name.toLocaleLowerCase() ===
        `${parsedLogo.name}.targetsize-64_altform-unplated${parsedLogo.ext}`.toLocaleLowerCase(),
    );
    const icon = nativeImage.createFromPath(
      preferredName ? path.join(parsedLogo.dir, preferredName) : exactLogoPath,
    );
    if (icon.isEmpty()) return undefined;
    const dataUrl = icon.resize({ width: 32, height: 32, quality: "good" }).toDataURL();
    return dataUrl.length <= MAX_ACTIVITY_ICON_DATA_URL_LENGTH ? dataUrl : undefined;
  } catch {
    return undefined;
  }
};

const loadExecutableIcon = async (
  executablePath?: string,
  activityId?: string,
): Promise<string | undefined> => {
  if (!executablePath || process.platform !== "win32") return undefined;
  try {
    if (activityId === "codex") {
      const manifestIcon = await loadCodexManifestIcon(executablePath);
      if (manifestIcon) return manifestIcon;
    }
    const icon = await app.getFileIcon(executablePath, { size: "large" });
    const dataUrl = icon.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
    return dataUrl.length <= MAX_ACTIVITY_ICON_DATA_URL_LENGTH ? dataUrl : undefined;
  } catch {
    return undefined;
  }
};

const cleanMusicTitle = (title: string, rule: MusicRule): string => {
  let cleaned = title.trim();
  for (const suffix of [rule.providerName, ...rule.genericTitles]) {
    if (!cleaned.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) continue;
    const prefix = cleaned.slice(0, -suffix.length).trimEnd();
    const delimiter = prefix.at(-1);
    if (delimiter === "-" || delimiter === "—" || delimiter === "|" || delimiter === "·") {
      cleaned = prefix.slice(0, -1).trimEnd();
    }
  }
  return cleaned;
};

export const matchMusicActivity = (
  processSnapshot: string | ProcessSnapshot[],
): MusicActivity | undefined => {
  const processes = Array.isArray(processSnapshot)
    ? processSnapshot
    : parseProcessSnapshot(processSnapshot);

  for (const processInfo of processes) {
    const processName = normalizeProcessName(processInfo.ProcessName);
    const executableName = normalizeProcessName(
      processInfo.Path ? path.basename(processInfo.Path) : undefined,
    );
    const rawTitle = processInfo.MainWindowTitle?.trim() ?? "";
    const normalizedTitle = rawTitle.toLocaleLowerCase();
    const isAppleMusicHostedWindow =
      (processName === "applicationframehost" || executableName === "applicationframehost") &&
      (normalizedTitle.includes("apple music") || normalizedTitle.includes("itunes"));
    const rule = isAppleMusicHostedWindow
      ? MUSIC_RULES.find((candidate) => candidate.provider === "applemusic")
      : MUSIC_RULES.find((candidate) =>
          candidate.processNames.some((name) => {
            const normalized = normalizeProcessName(name);
            return normalized === processName || normalized === executableName;
          }),
        );
    if (!rule) continue;

    const cleanedTitle = cleanMusicTitle(rawTitle, rule);
    const isGeneric = rule.genericTitles.some(
      (title) => cleanedTitle.toLowerCase() === title.toLowerCase(),
    );
    if (!cleanedTitle || isGeneric) continue;

    const parts = cleanedTitle.split(/\s+(?:-|—|–|·)\s+/).filter(Boolean);
    return {
      provider: rule.provider,
      providerName: rule.providerName,
      trackTitle: parts[0]?.slice(0, 160) || cleanedTitle.slice(0, 160),
      artist: parts.length > 1 ? parts.slice(1).join(" · ").slice(0, 100) : undefined,
    };
  }
  return undefined;
};

export const matchMediaSessionMusicActivity = (
  mediaSessionSnapshot: string | MediaSessionSnapshot[],
): MusicActivity | undefined => {
  const sessions = Array.isArray(mediaSessionSnapshot)
    ? mediaSessionSnapshot
    : parseMediaSessionSnapshot(mediaSessionSnapshot);

  for (const session of sessions) {
    const source = session.SourceAppUserModelId?.trim().toLocaleLowerCase() ?? "";
    const isAppleMusic =
      source.includes("appleinc.applemusicwin") ||
      source.includes("applemusic") ||
      source.endsWith("!applemusic");
    if (!isAppleMusic || session.PlaybackStatus?.toLocaleLowerCase() !== "playing") continue;

    const trackTitle = session.Title?.trim();
    if (!trackTitle || trackTitle.toLocaleLowerCase() === "apple music") continue;

    const artist = session.Artist?.trim()
      .split(/\s+(?:—|–|-)\s+/)[0]
      ?.trim();
    return {
      provider: "applemusic",
      providerName: "Apple Music",
      trackTitle: trackTitle.slice(0, 160),
      artist: artist ? artist.slice(0, 100) : undefined,
    };
  }

  return undefined;
};

export const resolveStableMusicActivity = (
  detected: MusicActivity | undefined,
  previous: MusicActivity | undefined,
  consecutiveMisses: number,
): MusicActivity | undefined => {
  if (detected) return detected;
  return consecutiveMisses <= MUSIC_ACTIVITY_MISS_TOLERANCE ? previous : undefined;
};

export const resolveStableWorkActivity = (
  detected: WorkActivity | undefined,
  previous: WorkActivity | undefined,
  consecutiveMisses: number,
): WorkActivity | undefined => {
  if (detected) return detected;
  return consecutiveMisses <= WORK_ACTIVITY_MISS_TOLERANCE ? previous : undefined;
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
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    'Add-Type -Namespace ShangHaoWin32 -Name NativeMethods -MemberDefinition \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);\'',
    "$foregroundHandle=[ShangHaoWin32.NativeMethods]::GetForegroundWindow()",
    "$foregroundProcessId=0; if ($foregroundHandle -ne [IntPtr]::Zero) { [void][ShangHaoWin32.NativeMethods]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId) }",
    "function ConvertTo-Utf8Base64([string]$Value) { if ([string]::IsNullOrEmpty($Value)) { return ''; }; return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value)); }",
    `$commandLineProcessNames=@(${processNameArray})`,
    "Get-Process | ForEach-Object {",
    "  $processPath = ''",
    "  $commandLine = ''",
    "  try { $processPath = $_.Path } catch {}",
    "  if ($commandLineProcessNames -contains $_.ProcessName.ToLowerInvariant()) {",
    '    try { $processDetails = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)"; $commandLine = $processDetails.CommandLine; if (-not $processPath) { $processPath = $processDetails.ExecutablePath } } catch {}',
    "  }",
    "  [PSCustomObject]@{ ProcessName=$_.ProcessName; MainWindowTitleBase64=(ConvertTo-Utf8Base64 $_.MainWindowTitle); PathBase64=(ConvertTo-Utf8Base64 $processPath); CommandLineBase64=(ConvertTo-Utf8Base64 $commandLine); IsForeground=($_.Id -eq $foregroundProcessId) }",
    "} | ConvertTo-Json -Compress",
  ].join("; ");
};

export const buildMediaSessionProbeCommand = (): string =>
  [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "function ConvertTo-Utf8Base64([string]$Value) { if ([string]::IsNullOrEmpty($Value)) { return ''; }; return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value)); }",
    "$managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]",
    "$propertiesType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]",
    "$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1",
    "$managerTask=$asTask.MakeGenericMethod($managerType).Invoke($null,@($managerType::RequestAsync()))",
    "$manager=$managerTask.GetAwaiter().GetResult()",
    "$sessions=@($manager.GetSessions() | ForEach-Object { $session=$_; $propertiesTask=$asTask.MakeGenericMethod($propertiesType).Invoke($null,@($session.TryGetMediaPropertiesAsync())); $properties=$propertiesTask.GetAwaiter().GetResult(); [PSCustomObject]@{ SourceAppUserModelId=$session.SourceAppUserModelId; TitleBase64=(ConvertTo-Utf8Base64 $properties.Title); ArtistBase64=(ConvertTo-Utf8Base64 $properties.Artist); PlaybackStatus=$session.GetPlaybackInfo().PlaybackStatus.ToString() } })",
    "if ($sessions.Count -eq 0) { Write-Output '[]' } else { $sessions | ConvertTo-Json -Compress }",
  ].join("; ");

const detectActivities = async (): Promise<
  Pick<GameDetectionSnapshot, "gameName" | "gameIconDataUrl" | "musicActivity" | "workActivity">
> => {
  if (process.platform !== "win32") return {};

  const commandOptions = { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 5_000 };
  const [processResult, mediaSessionResult] = await Promise.all([
    execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", buildGameDetectionProbeCommand()],
      commandOptions,
    ).catch(() => ({ stdout: "" })),
    execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", buildMediaSessionProbeCommand()],
      commandOptions,
    ).catch(() => ({ stdout: "" })),
  ]);

  const processes = parseProcessSnapshot(processResult.stdout);
  const game = matchKnownGameActivity(processes);
  const work = matchKnownWorkActivityWithProcess(processes);
  const [gameIconDataUrl, workIconDataUrl] = await Promise.all([
    loadExecutableIcon(game?.executablePath),
    loadExecutableIcon(work?.executablePath, work?.activity.id),
  ]);
  return {
    gameName: game?.activity,
    gameIconDataUrl,
    musicActivity:
      matchMediaSessionMusicActivity(mediaSessionResult.stdout) ?? matchMusicActivity(processes),
    workActivity: work ? { ...work.activity, iconDataUrl: workIconDataUrl } : undefined,
  };
};

export class GameDetectionController {
  private timer: NodeJS.Timeout | undefined;
  private enabled = false;
  private checkInFlight = false;
  private musicActivityMisses = 0;
  private workActivityMisses = 0;
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
      this.musicActivityMisses = 0;
      this.workActivityMisses = 0;
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
    this.musicActivityMisses = 0;
    this.workActivityMisses = 0;
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
    const previousGameIconDataUrl = this.snapshot.gameIconDataUrl;
    const previousMusicKey = JSON.stringify(this.snapshot.musicActivity ?? null);
    const previousWorkKey = JSON.stringify(this.snapshot.workActivity ?? null);
    const {
      gameName,
      gameIconDataUrl,
      musicActivity: detectedMusicActivity,
      workActivity: detectedWorkActivity,
    } = await detectActivities().finally(() => {
      this.checkInFlight = false;
    });
    if (!this.enabled) return;
    this.musicActivityMisses = detectedMusicActivity ? 0 : this.musicActivityMisses + 1;
    const musicActivity = resolveStableMusicActivity(
      detectedMusicActivity,
      this.snapshot.musicActivity,
      this.musicActivityMisses,
    );
    this.workActivityMisses = detectedWorkActivity ? 0 : this.workActivityMisses + 1;
    const workActivity = resolveStableWorkActivity(
      detectedWorkActivity,
      this.snapshot.workActivity,
      this.workActivityMisses,
    );
    this.snapshot = {
      gameName,
      gameIconDataUrl,
      musicActivity,
      workActivity,
      detectedAt: gameName
        ? previousGame === gameName
          ? this.snapshot.detectedAt
          : new Date().toISOString()
        : undefined,
      checkedAt: new Date().toISOString(),
    };

    const musicKey = JSON.stringify(musicActivity ?? null);
    const workKey = JSON.stringify(workActivity ?? null);
    if (
      previousGame === gameName &&
      previousGameIconDataUrl === gameIconDataUrl &&
      previousMusicKey === musicKey &&
      previousWorkKey === workKey
    )
      return;
    await this.writeLog({
      category: "app",
      level: "info",
      message: "Desktop activity changed",
      context: { gameName, musicProvider: musicActivity?.provider, workApp: workActivity?.id },
    });
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
