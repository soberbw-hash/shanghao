import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_3420: ReleaseHistoryEntry = {
  version: "3.4.20",
  date: "2026-11-17",
  title: "房间体验与设置优化",
  summary: "改善房间管理、语音回溯、设置和游戏识别。",
  highlights: [
    "直接在房间管理中修改名称和头像，对话回溯入口更简洁。",
    "统一设置界面样式，适配和平精英模拟器的游戏识别。",
    "临时联机增加服务器房间和直接连接选项，云端能力取决于服务器支持。",
  ],
  details: [
    {
      title: "录音与房间",
      items: ["优化录音转录、游戏语境和房间纪事。", "改进头像、管理员功能与设置界面的使用体验。"],
    },
  ],
};
