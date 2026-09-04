import type { QuickMessagePreset, QuickMessageShortcutSlot } from "../types/quick-message.types";

/** The remaining compatibility presets stay first so existing shortcuts keep their IDs. */
const LEGACY_QUICK_MESSAGE_PRESETS: QuickMessagePreset[] = [
  {
    id: "legacy-shanghao",
    label: "上号",
    content: "上号",
    category: "未分类",
    soundId: "legacy-animal-call",
    streamer: "康康",
    gameTags: ["瓦罗兰特"],
  },
  {
    id: "legacy-mic",
    label: "开麦",
    content: "开麦",
    category: "默认语音",
    soundId: "default-voice-开麦",
  },
  {
    id: "legacy-wait",
    label: "等我",
    content: "等我",
    category: "默认语音",
    soundId: "default-voice-等我",
  },
  {
    id: "legacy-hear",
    label: "听得到吗",
    content: "听得到吗",
    category: "默认语音",
    soundId: "default-voice-听得到吗",
  },
];

const DEFAULT_VOICE_QUICK_MESSAGE_PRESETS: QuickMessagePreset[] = [
  {
    id: "default-voice-上个厕所",
    label: "上个厕所",
    content: "上个厕所",
    category: "默认语音",
    soundId: "default-voice-上个厕所",
  },
  {
    id: "default-voice-都哥们",
    label: "都哥们",
    content: "都哥们",
    category: "默认语音",
    soundId: "default-voice-都哥们",
  },
  {
    id: "default-voice-开",
    label: "开",
    content: "开",
    category: "默认语音",
    soundId: "default-voice-开",
  },
];

const createLocalVoicePreset = (input: {
  id: string;
  name: string;
  soundId: string;
  streamer?: string;
  gameTags?: string[];
}): QuickMessagePreset => ({
  id: input.id,
  label: input.name,
  content: input.name,
  category: "未分类",
  mediaType: "voice",
  soundId: input.soundId,
  streamer: input.streamer,
  gameTags: input.gameTags,
});

/** User-provided local voice pack. Files are kept under resources/quick-messages in source order. */
const LOCAL_QUICK_MESSAGE_PRESETS: QuickMessagePreset[] = [
  createLocalVoicePreset({ id: "voice-nice", name: "nice", soundId: "voice-nice" }),
  createLocalVoicePreset({
    id: "voice-you-have-brother",
    name: "有的兄弟",
    soundId: "voice-you-have-brother",
  }),
  createLocalVoicePreset({
    id: "voice-rush",
    name: "猛攻",
    soundId: "voice-rush",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-sunxiaochuan-你吼那么大声",
    name: "吼大声",
    soundId: "voice-sunxiaochuan-你吼那么大声",
    streamer: "孙笑川",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-wawa-赋能哥",
    name: "赋能哥？",
    soundId: "voice-wawa-赋能哥",
    streamer: "瓦瓦",
    gameTags: ["无主契约"],
  }),
  createLocalVoicePreset({
    id: "voice-wawa-颗秒",
    name: "颗秒",
    soundId: "voice-wawa-颗秒",
    streamer: "瓦瓦",
    gameTags: ["无主契约"],
  }),
  createLocalVoicePreset({
    id: "voice-xiaoming-回答我",
    name: "回答我",
    soundId: "voice-xiaoming-回答我",
    streamer: "小明剑魔",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-嘿嘿",
    name: "嘿嘿",
    soundId: "voice-dasima-嘿嘿",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-很烦",
    name: "很烦",
    soundId: "voice-dasima-很烦",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-回手掏",
    name: "回手掏",
    soundId: "voice-dasima-回手掏",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-捞",
    name: "捞",
    soundId: "voice-dasima-捞",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-神魔恋",
    name: "神魔恋",
    soundId: "voice-dasima-神魔恋",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-呦",
    name: "呦~",
    soundId: "voice-dasima-呦",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-dasima-走位",
    name: "走位",
    soundId: "voice-dasima-走位",
    streamer: "大司马",
    gameTags: ["英雄联盟"],
  }),
  createLocalVoicePreset({
    id: "voice-pdd-可以说话吗",
    name: "可以说话",
    soundId: "voice-pdd-可以说话吗",
    streamer: "PDD",
    gameTags: ["英雄联盟", "绝地求生"],
  }),
  createLocalVoicePreset({
    id: "voice-pdd-溜了",
    name: "溜了",
    soundId: "voice-pdd-溜了",
    streamer: "PDD",
    gameTags: ["英雄联盟", "绝地求生"],
  }),
  createLocalVoicePreset({
    id: "voice-lubwei-全体起立",
    name: "全体起立",
    soundId: "voice-lubwei-全体起立",
    streamer: "卢本伟",
    gameTags: ["英雄联盟", "绝地求生"],
  }),
  createLocalVoicePreset({
    id: "voice-lubwei-伞兵一号",
    name: "伞兵一号",
    soundId: "voice-lubwei-伞兵一号",
    streamer: "卢本伟",
    gameTags: ["英雄联盟", "绝地求生"],
  }),
  createLocalVoicePreset({
    id: "voice-lubwei-玩你妈",
    name: "玩你妈",
    soundId: "voice-lubwei-玩你妈",
    streamer: "卢本伟",
    gameTags: ["英雄联盟", "绝地求生"],
  }),
  createLocalVoicePreset({
    id: "voice-lubwei-玩游戏要笑",
    name: "要笑",
    soundId: "voice-lubwei-玩游戏要笑",
    streamer: "卢本伟",
    gameTags: ["英雄联盟", "绝地求生"],
  }),
  createLocalVoicePreset({
    id: "voice-suxing-花来",
    name: "花来",
    soundId: "voice-suxing-花来",
    streamer: "苏醒",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-suxing-刘涛",
    name: "刘涛",
    soundId: "voice-suxing-刘涛",
    streamer: "苏醒",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-suxing-头甲枪",
    name: "头甲枪",
    soundId: "voice-suxing-头甲枪",
    streamer: "苏醒",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-suxing-一秒变异",
    name: "一秒变异",
    soundId: "voice-suxing-一秒变异",
    streamer: "苏醒",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-yangqijia-金图纸",
    name: "金图纸",
    soundId: "voice-yangqijia-金图纸",
    streamer: "杨齐家",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-liwo-滴滴",
    name: "滴滴",
    soundId: "voice-liwo-滴滴",
    streamer: "梨涡",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-liwo-什么",
    name: "什么",
    soundId: "voice-liwo-什么",
    streamer: "梨涡",
    gameTags: ["三角洲行动"],
  }),
  createLocalVoicePreset({
    id: "voice-liwo-我哩豆",
    name: "我哩豆",
    soundId: "voice-liwo-我哩豆",
    streamer: "梨涡",
    gameTags: ["三角洲行动"],
  }),
];

const createLocalMusicPreset = (input: {
  id: string;
  name: string;
  soundId: string;
  gameTags: string[];
}): QuickMessagePreset => ({
  id: input.id,
  label: input.name,
  content: input.name,
  category: "未分类",
  mediaType: "music",
  soundId: input.soundId,
  gameTags: input.gameTags,
});

/** Short game-music clips keep their original song titles and carry game tags. */
export const LOCAL_MUSIC_PRESETS: QuickMessagePreset[] = [
  createLocalMusicPreset({
    id: "music-delta-出泪小曲",
    name: "出泪小曲",
    soundId: "music-delta-出泪小曲",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-delta-出心小曲",
    name: "出心小曲",
    soundId: "music-delta-出心小曲",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-delta-得吃小曲",
    name: "得吃小曲",
    soundId: "music-delta-得吃小曲",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-delta-难得真兄弟",
    name: "难得真兄弟",
    soundId: "music-delta-难得真兄弟",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-delta-偷吃小曲",
    name: "偷吃小曲",
    soundId: "music-delta-偷吃小曲",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-delta-花来小曲",
    name: "花来小曲",
    soundId: "music-delta-花来小曲",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-delta-巡飞弹小曲",
    name: "巡飞弹小曲",
    soundId: "music-delta-巡飞弹小曲",
    gameTags: ["三角洲行动"],
  }),
  createLocalMusicPreset({
    id: "music-lol-卡特小曲",
    name: "卡特小曲",
    soundId: "music-lol-卡特小曲",
    gameTags: ["英雄联盟"],
  }),
  createLocalMusicPreset({
    id: "music-lol-潘森小曲",
    name: "潘森小曲",
    soundId: "music-lol-潘森小曲",
    gameTags: ["英雄联盟"],
  }),
  createLocalMusicPreset({
    id: "music-cf-大哥小曲",
    name: "大哥小曲",
    soundId: "music-cf-大哥小曲",
    gameTags: ["穿越火线"],
  }),
  createLocalMusicPreset({
    id: "music-csgo-预瞄小曲",
    name: "预瞄小曲",
    soundId: "music-csgo-预瞄小曲",
    gameTags: ["CSGO"],
  }),
  createLocalMusicPreset({
    id: "music-valorant-霓虹小曲",
    name: "霓虹小曲",
    soundId: "music-valorant-霓虹小曲",
    gameTags: ["瓦罗兰特"],
  }),
  createLocalMusicPreset({
    id: "music-valorant-颗秒小曲",
    name: "颗秒小曲",
    soundId: "music-valorant-颗秒小曲",
    gameTags: ["瓦罗兰特"],
  }),
];

/** The first music clip is the initial choice for the dedicated music button. */
export const DEFAULT_QUICK_MESSAGE_MUSIC_PRESET_ID = LOCAL_MUSIC_PRESETS[0]?.id;

export const DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS: QuickMessageShortcutSlot[] = [
  {
    presetId: LOCAL_MUSIC_PRESETS[0]?.id,
    shortcut: "Ctrl+Shift+1",
    enabled: true,
  },
  {
    presetId: LOCAL_MUSIC_PRESETS[1]?.id,
    shortcut: "Ctrl+Shift+2",
    enabled: true,
  },
  {
    presetId: LOCAL_MUSIC_PRESETS[2]?.id,
    shortcut: "Ctrl+Shift+3",
    enabled: true,
  },
];

export const QUICK_MESSAGE_PRESETS: QuickMessagePreset[] = [
  ...LEGACY_QUICK_MESSAGE_PRESETS,
  ...DEFAULT_VOICE_QUICK_MESSAGE_PRESETS,
  ...LOCAL_QUICK_MESSAGE_PRESETS,
  ...LOCAL_MUSIC_PRESETS,
];

/** Shared default for voice effects and music; source mastering remains independent. */
export const DEFAULT_QUICK_MESSAGE_VOLUME = 0.68;

export const DEFAULT_QUICK_MESSAGE_SLOTS: QuickMessageShortcutSlot[] = [
  { presetId: undefined, shortcut: "Ctrl+Alt+1", enabled: false },
  { presetId: "legacy-shanghao", shortcut: "Ctrl+Alt+2", enabled: true },
  { presetId: "legacy-mic", shortcut: "Ctrl+Alt+3", enabled: true },
  { presetId: "legacy-wait", shortcut: "Ctrl+Alt+4", enabled: true },
  { presetId: "legacy-hear", shortcut: "Ctrl+Alt+5", enabled: true },
];

/**
 * Keep every consumer on the same fixed-size shortcut model. Older profiles
 * can contain a sparse or truncated array, while newer profiles may carry
 * extra slot metadata that should survive a read/write round trip.
 */
export const normalizeQuickMessageSlots = (
  value: unknown,
  defaults: readonly QuickMessageShortcutSlot[] = DEFAULT_QUICK_MESSAGE_SLOTS,
  count = defaults.length,
): QuickMessageShortcutSlot[] => {
  const rawSlots = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const fallback = defaults[index] ??
      defaults[0] ?? { presetId: undefined, shortcut: "", enabled: false };
    const candidate = rawSlots[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ...fallback };
    }
    const source = candidate as Record<string, unknown>;
    return {
      ...fallback,
      ...source,
      presetId:
        typeof source.presetId === "string"
          ? source.presetId.trim() || undefined
          : fallback.presetId,
      shortcut: typeof source.shortcut === "string" ? source.shortcut.trim() : fallback.shortcut,
      enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    } as QuickMessageShortcutSlot;
  });
};

export const findQuickMessagePreset = (presetId: string): QuickMessagePreset | undefined =>
  QUICK_MESSAGE_PRESETS.find((preset) => preset.id === presetId);

export const findQuickMessagePresetByContent = (content: string): QuickMessagePreset | undefined =>
  QUICK_MESSAGE_PRESETS.find((preset) => preset.content === content.trim());
