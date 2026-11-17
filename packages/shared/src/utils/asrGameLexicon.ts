import type { AsrGameLexiconEntry } from "../types/settings.types";

const BUILT_IN_GAME_LEXICONS: ReadonlyArray<{
  gameName: string;
  aliases: readonly string[];
  terms: readonly string[];
}> = [
  {
    gameName: "英雄联盟",
    aliases: ["League of Legends", "LOL", "LoL国服"],
    terms: [
      "英雄联盟",
      "大龙",
      "小龙",
      "先锋",
      "补刀",
      "兵线",
      "闪现",
      "打野",
      "反野",
      "上路",
      "中路",
      "下路",
      "ADC",
      "辅助",
      "团战",
      "开团",
    ],
  },
  {
    gameName: "无畏契约",
    aliases: ["VALORANT", "瓦罗兰特", "瓦"],
    terms: [
      "无畏契约",
      "瓦罗兰特",
      "A包点",
      "B包点",
      "下包",
      "拆包",
      "烟位",
      "闪光",
      "技能",
      "经济局",
      "残局",
      "架枪",
      "进攻方",
      "防守方",
      "爆能器",
      "点位",
    ],
  },
  {
    gameName: "和平精英",
    aliases: ["PUBG Mobile", "和平精英模拟器", "吃鸡"],
    terms: [
      "和平精英",
      "吃鸡",
      "决赛圈",
      "空投",
      "跳伞",
      "拉枪线",
      "救人",
      "封烟",
      "舔包",
      "伏地魔",
      "载具",
      "圈边",
      "毒圈",
      "补给箱",
      "四排",
      "撤离",
    ],
  },
  {
    gameName: "Apex Legends",
    aliases: ["Apex", "Apex英雄"],
    terms: [
      "Apex英雄",
      "恶灵",
      "寻血猎犬",
      "直布罗陀",
      "班加罗尔",
      "地平线",
      "传家宝",
      "护甲",
      "复活",
      "信标",
      "圈边",
      "跳点",
      "大招",
      "小队",
      "击倒",
      "补人",
    ],
  },
  {
    gameName: "守望先锋",
    aliases: ["Overwatch", "Overwatch 2", "守望先锋2"],
    terms: [
      "守望先锋",
      "源氏",
      "猎空",
      "天使",
      "安娜",
      "莱因哈特",
      "D.Va",
      "大招",
      "集火",
      "推车",
      "占点",
      "返场",
      "开团",
      "先手",
      "治疗",
      "护盾",
    ],
  },
];

const normalizeGameKey = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._-]+/gu, "");

const safeWord = (value: string, maximum: number) =>
  value.length <= maximum && /^[\p{L}\p{N} .+_-]+$/u.test(value);

export function isAsrGameLexiconEntry(value: unknown): value is AsrGameLexiconEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.gameName === "string" &&
    !!entry.gameName.trim() &&
    safeWord(entry.gameName, 40) &&
    Array.isArray(entry.terms) &&
    entry.terms.length <= 16 &&
    entry.terms.every((term) => typeof term === "string" && !!term.trim() && safeWord(term, 20))
  );
}

export function normalizeAsrGameLexicon(value: unknown): AsrGameLexiconEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: AsrGameLexiconEntry[] = [];
  const seenGames = new Set<string>();
  for (const candidate of value.slice(0, 50)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.gameName !== "string" ||
      !item.gameName.trim() ||
      !safeWord(item.gameName.trim(), 40) ||
      !Array.isArray(item.terms)
    )
      continue;
    const gameName = item.gameName.trim();
    const gameKey = gameName.normalize("NFKC").toLocaleLowerCase();
    if (seenGames.has(gameKey)) continue;
    const seenTerms = new Set<string>();
    const terms = item.terms
      .filter((term): term is string => typeof term === "string")
      .map((term) => term.trim().normalize("NFKC"))
      .filter((term) => {
        const key = term.toLocaleLowerCase();
        if (!term || !safeWord(term, 20) || seenTerms.has(key)) return false;
        seenTerms.add(key);
        return true;
      })
      .slice(0, 16);
    seenGames.add(gameKey);
    entries.push({ gameName, terms });
  }
  return entries;
}

export function findAsrGameLexicon(
  entries: readonly AsrGameLexiconEntry[] | undefined,
  gameName: string,
): AsrGameLexiconEntry | undefined {
  const key = gameName.trim().normalize("NFKC").toLocaleLowerCase();
  if (!key) return undefined;
  return entries?.find((entry) => entry.gameName.normalize("NFKC").toLocaleLowerCase() === key);
}

/** Uses the detected game name to select a small built-in glossary, then preserves personal terms. */
export function resolveAsrGameLexicon(
  entries: readonly AsrGameLexiconEntry[] | undefined,
  gameName: string,
): AsrGameLexiconEntry | undefined {
  const key = normalizeGameKey(gameName.trim());
  if (!key) return undefined;
  const builtIn = BUILT_IN_GAME_LEXICONS.find((entry) =>
    [entry.gameName, ...entry.aliases].some((name) => normalizeGameKey(name) === key),
  );
  const personal = entries?.find(
    (entry) =>
      normalizeGameKey(entry.gameName) === key ||
      (builtIn && normalizeGameKey(entry.gameName) === normalizeGameKey(builtIn.gameName)),
  );
  if (!builtIn) return personal;
  const terms = [...(personal?.terms ?? []), ...builtIn.terms];
  return {
    gameName: builtIn.gameName,
    terms: Array.from(new Map(terms.map((term) => [normalizeGameKey(term), term])).values()).slice(
      0,
      16,
    ),
  };
}
