import type { GameDetectionSnapshot } from "@private-voice/shared";

interface GameRule {
  name: NonNullable<GameDetectionSnapshot["gameName"]>;
  processNames: string[];
  titleNeedles?: string[];
  pathNeedles?: string[];
  commandLineNeedles?: string[];
  evidenceRequiredProcessNames?: string[];
}

export const KK_PLATFORM_GAME_NAME: NonNullable<GameDetectionSnapshot["gameName"]> = "KK 对战平台";
export const KK_HOSTED_PROCESS_NAMES = [
  "game_x64h",
  "war3",
  "war3n",
  "warcraft iii",
  "warcraft_iii",
];
export const KK_LAUNCHER_PROCESS_NAMES = new Set(["kk", "kkgamebox", "platform"]);
export const KK_PATH_NEEDLES = ["kkduizhan", "\\kk\\", "\\kkgame\\", "\\games\\y3\\"];

export const GAME_RULES: GameRule[] = [
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
  { name: "星露谷物语", processNames: ["stardew valley", "stardewvalley"] },
  {
    name: "英雄联盟",
    processNames: ["league of legends", "leagueoflegends", "leagueclient", "leagueclientux"],
  },
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
  { name: "GTA V", processNames: ["gta5", "gta5_enhanced"] },
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
  {
    name: "王者荣耀世界",
    processNames: ["hokworld", "honorofkingsworld", "world-win64-shipping"],
    titleNeedles: ["王者荣耀世界", "honor of kings world"],
    pathNeedles: ["hokworld", "honorofkingsworld"],
    evidenceRequiredProcessNames: ["world-win64-shipping"],
  },
  { name: "异人之下", processNames: ["thehiddenones", "yirenzhixia", "underoneperson"] },
  { name: "命运方舟", processNames: ["lostark", "lostarkclient", "lostarkclient-win64-shipping"] },
  {
    name: "塔瑞斯世界",
    processNames: ["tarisland", "tarislandclient", "tarisland-win64-shipping"],
  },
  { name: "剑灵 2", processNames: ["bns2", "bladeandsoul2", "bns2-win64-shipping"] },
  {
    name: "终极角逐",
    processNames: ["discovery", "thefinals", "discovery-win64-shipping"],
    titleNeedles: ["the finals", "终极角逐"],
    pathNeedles: ["the finals", "thefinals"],
    evidenceRequiredProcessNames: ["discovery"],
  },
  { name: "火箭联盟", processNames: ["rocketleague"] },
  { name: "泰拉瑞亚", processNames: ["terraria"] },
  { name: "哈迪斯", processNames: ["hades", "hades2"] },
  { name: "Warframe", processNames: ["warframe.x64", "warframe"] },
  { name: "命运 2", processNames: ["destiny2"] },
  { name: "绝地潜兵 2", processNames: ["helldivers2"] },
  { name: "漫威争锋", processNames: ["marvel-win64-shipping", "marvelrivals"] },
  { name: "黎明杀机", processNames: ["deadbydaylight-win64-shipping"] },
  { name: "致命公司", processNames: ["lethal company", "lethalcompany"] },
  { name: "R.E.P.O.", processNames: ["repo"] },
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
