/** Bundled AAC paths for local voice and music packs. IDs are shared with quick-messages.ts. */
const QUICK_MESSAGE_SOUND_PATHS: Record<string, string> = {
  "default-voice-上个厕所": "默认语音/上个厕所.aac",
  "default-voice-都哥们": "默认语音/都哥们.aac",
  "default-voice-开麦": "默认语音/开麦.aac",
  "default-voice-等我": "默认语音/等我.aac",
  "default-voice-开": "默认语音/开.aac",
  "default-voice-听得到吗": "默认语音/听得到吗.aac",
  "voice-sunxiaochuan-你吼那么大声": "孙笑川/你吼那么大声.aac",
  "voice-nice": "未分类/nice.aac",
  "voice-you-have-brother": "未分类/有的兄弟.aac",
  "voice-rush": "未分类/猛攻.aac",
  "voice-wawa-赋能哥": "瓦瓦/赋能哥？.aac",
  "voice-wawa-颗秒": "瓦瓦/颗秒.aac",
  "voice-xiaoming-回答我": "小明剑魔/回答我.aac",
  "voice-dasima-嘿嘿": "大司马/嘿嘿.aac",
  "voice-dasima-很烦": "大司马/很烦.aac",
  "voice-dasima-回手掏": "大司马/回手掏.aac",
  "voice-dasima-捞": "大司马/捞.aac",
  "voice-dasima-神魔恋": "大司马/神魔恋.aac",
  "voice-dasima-呦": "大司马/呦~.aac",
  "voice-dasima-走位": "大司马/走位.aac",
  "voice-pdd-可以说话吗": "PDD/可以说话吗.aac",
  "voice-pdd-溜了": "PDD/溜了.aac",
  "voice-lubwei-全体起立": "卢本伟/全体起立.aac",
  "voice-lubwei-伞兵一号": "卢本伟/伞兵一号.aac",
  "voice-lubwei-玩你妈": "卢本伟/玩你妈.aac",
  "voice-lubwei-玩游戏要笑": "卢本伟/玩游戏要笑.aac",
  "voice-suxing-花来": "苏醒/花来.aac",
  "voice-suxing-刘涛": "苏醒/刘涛.aac",
  "voice-suxing-头甲枪": "苏醒/头甲枪.aac",
  "voice-suxing-一秒变异": "苏醒/一秒变异.aac",
  "voice-yangqijia-金图纸": "杨齐家/金图纸.aac",
  "voice-liwo-滴滴": "梨涡/滴滴.aac",
  "voice-liwo-什么": "梨涡/什么.aac",
  "voice-liwo-我哩豆": "梨涡/我哩豆.aac",
  "music-delta-出泪小曲": "音乐/三角洲行动/出泪小曲.aac",
  "music-delta-出心小曲": "音乐/三角洲行动/出心小曲.aac",
  "music-delta-得吃小曲": "音乐/三角洲行动/得吃小曲.aac",
  "music-delta-难得真兄弟": "音乐/三角洲行动/难得真兄弟.aac",
  "music-delta-偷吃小曲": "音乐/三角洲行动/偷吃小曲.aac",
  "music-delta-花来小曲": "音乐/三角洲行动/花来小曲.aac",
  "music-delta-巡飞弹小曲": "音乐/三角洲行动/巡飞弹小曲.aac",
  "music-lol-卡特小曲": "音乐/英雄联盟/卡特小曲.aac",
  "music-lol-潘森小曲": "音乐/英雄联盟/潘森小曲.aac",
  "music-cf-大哥小曲": "音乐/穿越火线/大哥小曲.aac",
  "music-csgo-预瞄小曲": "音乐/CSGO/预瞄小曲.aac",
  "music-valorant-霓虹小曲": "音乐/瓦罗兰特/霓虹小曲.aac",
  "music-valorant-颗秒小曲": "音乐/瓦罗兰特/颗秒小曲.aac",
};

const toQuickMessageSoundUrl = (relativePath: string): string =>
  `shanghao-quick-message://audio/${relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

export const QUICK_MESSAGE_SOUND_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(QUICK_MESSAGE_SOUND_PATHS).map(([soundId, relativePath]) => [
    soundId,
    toQuickMessageSoundUrl(relativePath),
  ]),
);
