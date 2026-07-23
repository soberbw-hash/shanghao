const BLOCKED_NICKNAME_TERMS = [
  // Family-title bait and common phonetic/leet variants.
  "dad",
  "daddy",
  "dady",
  "daddie",
  "dadee",
  "father",
  "papa",
  "pappa",
  "papi",
  "baba",
  "babi",
  "yeye",
  "diedi",
  "grandpa",
  "grandfather",
  "爸爸",
  "爸比",
  "爸宝",
  "粑粑",
  "粑比",
  "巴巴",
  "芭芭",
  "拔拔",
  "父亲",
  "父王",
  "父皇",
  "义父",
  "爷爷",
  "爺爺",
  "耶耶",
  "椰椰",
  "祖父",
  "祖宗",
  "老子",
  "爹地",
  "跌地",
  "爹",

  // Direct insults, abusive slang and deliberately softened homophones.
  "傻逼",
  "傻比",
  "煞笔",
  "沙比",
  "莎比",
  "脑残",
  "弱智",
  "智障",
  "废物",
  "垃圾人",
  "狗东西",
  "狗杂种",
  "杂种",
  "畜生",
  "贱人",
  "婊子",
  "狗娘养",
  "孤儿",
  "死妈",
  "没妈",
  "妈死",
  "草泥马",
  "操你",
  "艹你",
  "肏你",
  "你妈逼",
  "妈卖批",
  "nmsl",
  "cnm",
  "sb",
  "shabi",
  "fuck",
  "fucker",
  "bitch",
  "cunt",
  "whore",
  "slut",
  "asshole",
  "motherfucker",

  // Sexual or suggestive nicknames are not appropriate for the shared room.
  "色情",
  "成人视频",
  "黄片",
  "黄网",
  "约炮",
  "裸聊",
  "裸照",
  "做爱",
  "性交",
  "口交",
  "强奸",
  "迷奸",
  "自慰",
  "撸管",
  "鸡巴",
  "几把",
  "牛子",
  "porn",
  "porno",
  "hentai",
  "nude",
  "nudes",
  "rape",
  "pussy",
  "dick",
  "cock",
];

const normalizeNickname = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/0/g, "o")
    .replace(/[^\p{L}\p{N}]/gu, "");

const BLOCKED_HOMOPHONE_PATTERNS = [
  /[爸粑巴芭八叭拔][爸粑巴芭八叭拔]/u,
  /[爸粑巴芭八叭拔][比币毕必逼]/u,
  /[爷爺耶椰][爷爺耶椰]/u,
  /[爹跌叠碟蝶][地帝弟]?/u,
];

export const getNicknameValidationError = (value: string): string | undefined => {
  const normalized = normalizeNickname(value.trim());
  if (!normalized) return "先填一个昵称。";
  if (
    BLOCKED_NICKNAME_TERMS.some((term) => normalized.includes(term)) ||
    BLOCKED_HOMOPHONE_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return "这个昵称容易冒犯朋友，换一个正常称呼吧。";
  }
  return undefined;
};
