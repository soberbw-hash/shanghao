import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_3423: ReleaseHistoryEntry = {
  version: "3.4.23",
  date: "2026-11-20",
  title: "正式版屏幕分享与房间纪事",
  highlights: [
    "修复 Windows 正式版选中显示器后无法启动采集的问题。",
    "统一聊天链接卡片尺寸并优化设置和录音库布局。",
    "同房成员可查看当天纪事，转录参考当前游戏和房间记忆。",
  ],
  details: [
    {
      title: "正式版屏幕分享",
      items: ["客户端默认使用普通用户权限，打包后实际读取一帧屏幕画面。"],
    },
    {
      title: "房间纪事",
      items: ["房间纪事在北京时间零点换日，昨日回顾聚焦具体片段。"],
    },
  ],
};
