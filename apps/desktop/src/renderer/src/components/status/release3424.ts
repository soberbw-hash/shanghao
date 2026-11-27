import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_3424: ReleaseHistoryEntry = {
  version: "3.4.24",
  date: "2026-11-27",
  title: "房间语音、桌面通知与交互优化",
  highlights: [
    "确认加入后才收听房间并申请麦克风，退出即关闭语音。",
    "桌面通知可直接进房、定位消息或打开对应语音片段。",
    "聊天和纪事切换保留草稿，送达确认保留阅读位置。",
  ],
  details: [
    {
      title: "房间体验",
      items: ["手动开麦同步结束临时状态。改善进出房间、聊天列表和放歌的交互。"],
    },
    {
      title: "录音与纪事",
      items: ["录音库本地保存，自动录音和转录独立设置。昨日回顾根据实际活动和可用纪事整理。"],
    },
    {
      title: "维护工具",
      items: ["在关于上号可访问官网、导出日志、查看占用、清理过期临时文件和安全重置。"],
    },
  ],
};
