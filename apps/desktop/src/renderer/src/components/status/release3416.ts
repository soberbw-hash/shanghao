import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_3416: ReleaseHistoryEntry = {
  version: "3.4.16",
  date: "2026-10-28",
  title: "官方服务直连阿里云",
  summary: "更新官方连接地址，并保留已有自定义服务器设置。",
  highlights: ["官方房间服务改为直接连接阿里云。", "旧版官方地址在升级时迁移，自定义地址不变。"],
  details: [
    {
      title: "升级与兼容",
      items: [
        "本地录音、聊天和个人设置不会因切换服务器而被清除。",
        "旧版客户端暂时仍可通过原入口连接，请逐步更新。",
      ],
    },
  ],
};
