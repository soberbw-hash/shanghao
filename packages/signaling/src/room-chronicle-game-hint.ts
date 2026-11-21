import {
  normalizeAsrGameLexicon,
  resolveAsrGameLexicon,
  type AsrGameLexiconEntry,
  type GameSessionActivity,
  type MemberActivity,
} from "@private-voice/shared";

export interface ChronicleGameHint extends AsrGameLexiconEntry {
  scope?: "speaker" | "room";
  phase?: GameSessionActivity["phase"];
  mode?: GameSessionActivity["mode"];
}

interface MemberGame {
  gameName?: string;
  gameSession?: GameSessionActivity;
  activity?: MemberActivity;
}

const LEAGUE_PHASE_TERMS: Partial<Record<GameSessionActivity["phase"], readonly string[]>> = {
  lobby: ["双排", "五排", "组队", "补位"],
  matchmaking: ["排队", "匹配", "双排", "补位"],
  "ready-check": ["确认对局", "排到了", "补位"],
  "champ-select": ["禁用", "选人", "换位", "锁英雄", "一抢", "康特", "补位"],
  "in-game": [
    "兵线",
    "补刀",
    "反野",
    "控龙",
    "先锋",
    "巢虫",
    "闪现",
    "开团",
    "回城",
    "传送",
    "推塔",
  ],
  "post-game": ["复盘", "战绩", "翻盘", "下一把", "掉分"],
};

const TFT_TERMS = [
  "云顶之弈",
  "羁绊",
  "弈子",
  "海克斯",
  "选秀",
  "经济",
  "利息",
  "搜牌",
  "升人口",
  "装备",
];
const ARAM_TERMS = ["大乱斗", "雪球", "换英雄", "开团", "团战", "防御塔", "兵线", "大招"];
const AWAY = new Set<MemberActivity>(["drinking", "fitness", "restroom"]);
const folded = (value: string) => value.normalize("NFKC").trim().toLowerCase();

const gameOf = (member?: MemberGame) => {
  if (!member?.gameName || (member.activity && AWAY.has(member.activity))) return undefined;
  const entry =
    resolveAsrGameLexicon(undefined, member.gameName) ??
    normalizeAsrGameLexicon([{ gameName: member.gameName, terms: [] }])[0];
  if (!entry) return undefined;
  const session = entry.gameName === "英雄联盟" ? member.gameSession : undefined;
  return { ...entry, phase: session?.phase, mode: session?.mode };
};

/** Presence is a vocabulary hint: a room hint must never be attributed to the microphone owner. */
export function selectChronicleGameHint(
  speaker: MemberGame | undefined,
  roomMembers: readonly MemberGame[],
  submitted?: AsrGameLexiconEntry,
): ChronicleGameHint | undefined {
  const ownGame = gameOf(speaker);
  const roomGames = ownGame ? [] : roomMembers.flatMap((member) => gameOf(member) ?? []);
  const commonGame = roomGames[0];
  let game = ownGame;
  if (
    !game &&
    commonGame &&
    (roomGames.length >= 2 || commonGame.phase === "in-game") &&
    roomGames.every((candidate) => folded(candidate.gameName) === folded(commonGame.gameName)) &&
    !roomGames.some(
      ({ mode }) =>
        (mode === "云顶之弈" || mode === "大乱斗") &&
        roomGames.some((candidate) => candidate.mode !== mode),
    )
  ) {
    game = {
      ...commonGame,
      phase: roomGames.every((candidate) => candidate.phase === commonGame.phase)
        ? commonGame.phase
        : undefined,
      mode: roomGames.every((candidate) => candidate.mode === commonGame.mode)
        ? commonGame.mode
        : undefined,
    };
  }
  if (!game) return undefined;

  const { gameName, phase, mode } = game;
  const submittedName =
    submitted &&
    (resolveAsrGameLexicon(undefined, submitted.gameName)?.gameName ?? submitted.gameName);
  // Presence can change while a chunk is recording. Conflicting context is worse than no hint.
  if (submittedName && folded(submittedName) !== folded(gameName)) return undefined;
  const isLeague = gameName === "英雄联盟";
  const specialMode = isLeague && (mode === "云顶之弈" || mode === "大乱斗");
  const stageTerms = isLeague && phase ? (LEAGUE_PHASE_TERMS[phase] ?? []) : [];
  const suppliedTerms = ownGame ? (submitted?.terms ?? []) : [];
  // Captured clients often send the built-in list too; keep only actual custom additions.
  const customTerms = suppliedTerms.filter(
    (term) => !game.terms.some((common) => folded(common) === folded(term)),
  );
  const defaults = specialMode
    ? mode === "云顶之弈"
      ? TFT_TERMS
      : ARAM_TERMS
    : [...stageTerms, ...game.terms];
  const normalized = normalizeAsrGameLexicon([
    { gameName, terms: [...customTerms.slice(0, 8), ...defaults, ...customTerms.slice(8)] },
  ])[0];
  return normalized
    ? { ...normalized, phase, mode, scope: ownGame ? "speaker" : "room" }
    : undefined;
}
