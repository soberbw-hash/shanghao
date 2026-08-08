const FAMILY_TITLE_FRAGMENTS = [
  // English family-title bait and common phonetic variants.
  "daddy",
  "dada",
  "dadda",
  "dadaa",
  "dady",
  "daddie",
  "dadee",
  "father",
  "stepdad",
  "sugardaddy",
  "yourdad",
  "yourdada",
  "yourdaddy",
  "urdad",
  "urdada",
  "urdaddy",
  "mydad",
  "mydaddy",
  "youfather",
  "yourfather",
  "papa",
  "pappa",
  "pappy",
  "papi",
  "baba",
  "babi",
  "babbi",
  "grandpa",
  "grandfather",
  "mommy",
  "mummy",
  "mother",
  "mama",
  "mami",
  "grandma",
  "grandmother",

  // Chinese family titles and deliberately softened homophones.
  "爸爸",
  "爸比",
  "爸币",
  "爸毕",
  "爸逼",
  "爸宝",
  "粑粑",
  "粑比",
  "巴巴",
  "巴比",
  "芭芭",
  "芭比",
  "拔拔",
  "霸霸",
  "父亲",
  "父王",
  "父皇",
  "父上",
  "义父",
  "干爹",
  "乾爹",
  "亲爹",
  "老爹",
  "爹地",
  "跌地",
  "爹爹",
  "爷爷",
  "爺爺",
  "耶耶",
  "椰椰",
  "祖父",
  "祖宗",
  "老祖宗",
  "太爷",
  "外公",
  "妈妈",
  "媽媽",
  "妈咪",
  "媽咪",
  "母亲",
  "母親",
  "母上",
  "干妈",
  "乾媽",
  "奶奶",
  "祖母",
  "外婆",
  "姥姥",
];

const ABUSIVE_FRAGMENTS = [
  "傻逼",
  "傻比",
  "煞笔",
  "沙比",
  "莎比",
  "脑残",
  "腦殘",
  "脑瘫",
  "腦癱",
  "弱智",
  "智障",
  "废物",
  "廢物",
  "垃圾人",
  "狗东西",
  "狗東西",
  "狗杂种",
  "狗雜種",
  "杂种",
  "雜種",
  "畜生",
  "贱人",
  "賤人",
  "婊子",
  "狗娘养",
  "狗娘養",
  "孤儿",
  "孤兒",
  "死妈",
  "死媽",
  "没妈",
  "沒媽",
  "妈死",
  "媽死",
  "草泥马",
  "草泥馬",
  "操你",
  "艹你",
  "肏你",
  "你妈逼",
  "你媽逼",
  "妈卖批",
  "媽賣批",
  "曹尼玛",
  "曹尼瑪",
  "黑鬼",
  "支那",
  "小日本",
  "狗汉奸",
  "狗漢奸",
  "shabi",
  "nmsl",
  "fuck",
  "fucker",
  "bitch",
  "cunt",
  "whore",
  "slut",
  "asshole",
  "motherfucker",
  "retard",
];

const SUGGESTIVE_FRAGMENTS = [
  "色情",
  "成人视频",
  "成人影片",
  "黄片",
  "黃片",
  "黄网",
  "黃網",
  "约炮",
  "約炮",
  "裸聊",
  "裸照",
  "做爱",
  "做愛",
  "性交",
  "口交",
  "强奸",
  "強姦",
  "迷奸",
  "迷姦",
  "自慰",
  "撸管",
  "擼管",
  "鸡巴",
  "雞巴",
  "几把",
  "牛子",
  "援交",
  "卖淫",
  "賣淫",
  "嫖娼",
  "外围",
  "外圍",
  "福利姬",
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

const POLITICAL_FRAGMENTS = [
  "习近平",
  "習近平",
  "习近苹",
  "习进平",
  "习禁评",
  "习禁平",
  "习尽平",
  "习主席",
  "习大大",
  "习包子",
  "习维尼",
  "毛泽东",
  "毛澤東",
  "毛主席",
  "邓小平",
  "鄧小平",
  "江泽民",
  "江澤民",
  "胡锦涛",
  "胡錦濤",
  "胡耀邦",
  "赵紫阳",
  "趙紫陽",
  "李克强",
  "李克強",
  "温家宝",
  "溫家寶",
  "朱镕基",
  "朱鎔基",
  "李强",
  "李強",
  "蒋介石",
  "蔣介石",
  "孙中山",
  "孫中山",
  "蔡英文",
  "赖清德",
  "賴清德",
  "中国共产党",
  "中國共產黨",
  "共产党",
  "共產黨",
  "中共",
  "政治局",
  "中南海",
  "天安门事件",
  "天安門事件",
  "六四事件",
  "法轮功",
  "法輪功",
  "台独",
  "台獨",
  "港独",
  "港獨",
  "藏独",
  "藏獨",
  "疆独",
  "疆獨",
  "xijinping",
  "maozedong",
  "dengxiaoping",
  "jiangzemin",
  "hujintao",
];

const BLOCKED_FRAGMENTS = [
  ...FAMILY_TITLE_FRAGMENTS,
  ...ABUSIVE_FRAGMENTS,
  ...SUGGESTIVE_FRAGMENTS,
  ...POLITICAL_FRAGMENTS,
];

// Short Latin aliases are checked as complete Latin runs to avoid rejecting
// ordinary names that merely contain the same two or three letters.
const BLOCKED_SHORT_LATIN_TOKENS = new Set(["dad", "mom", "sb", "cnm", "xjp", "ccp"]);

const BLOCKED_EXACT_COMPACT_VALUES = new Set(["爹", "爸", "妈", "媽", "爷", "爺", "8964"]);

const BLOCKED_HOMOPHONE_PATTERNS = [
  /[爸粑巴芭八叭拔霸][爸粑巴芭八叭拔霸]/u,
  /[爸粑巴芭八叭拔霸][比币幣毕畢必逼]/u,
  /[爷爺耶椰][爷爺耶椰]/u,
  /[爹跌叠疊碟蝶][地帝弟]?/u,
  /[妈媽麻马馬][妈媽麻咪米]/u,
  /习[近进進禁尽盡][平苹評评]/u,
];

const compactNickname = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}@!|$]/gu, "");

const normalizeNickname = (value: string): string =>
  compactNickname(value)
    .replace(/[@4]/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/3/g, "e")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/0/g, "o")
    .replace(/[^\p{L}\p{N}]/gu, "");

const getLatinRuns = (value: string): string[] => value.match(/[a-z0-9]+/g) ?? [];

const isBlockedShortLatinToken = (token: string): boolean => {
  if (BLOCKED_SHORT_LATIN_TOKENS.has(token)) return true;

  // Numeric prefixes and suffixes are commonly appended to a blocked short
  // title (for example dad123 or 520mom) to bypass exact-token checks.
  const core = token
    .replace(/^\d+|\d+$/g, "")
    .replace(/4/g, "a")
    .replace(/0/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t");
  return core !== token && BLOCKED_SHORT_LATIN_TOKENS.has(core);
};

export const getNicknameValidationError = (value: string): string | undefined => {
  const trimmed = value.trim();
  const compact = compactNickname(trimmed).replace(/[^\p{L}\p{N}]/gu, "");
  const normalized = normalizeNickname(trimmed);
  if (!normalized) return "先填一个昵称。";

  const containsBlockedFragment = BLOCKED_FRAGMENTS.some((term) => normalized.includes(term));
  const containsBlockedShortToken = [...getLatinRuns(compact), ...getLatinRuns(normalized)].some(
    isBlockedShortLatinToken,
  );
  const matchesBlockedHomophone = BLOCKED_HOMOPHONE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );

  if (
    containsBlockedFragment ||
    containsBlockedShortToken ||
    BLOCKED_EXACT_COMPACT_VALUES.has(compact) ||
    matchesBlockedHomophone
  ) {
    return "这个昵称包含不适合公开展示的内容，换一个正常称呼吧。";
  }
  return undefined;
};

export const isAllowedNickname = (value: string): boolean =>
  getNicknameValidationError(value) === undefined;
