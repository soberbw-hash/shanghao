import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_3425: ReleaseHistoryEntry = {
  version: "3.4.25",
  date: "2026-11-27",
  title: "房间弹窗、聊天与 AI 设置",
  highlights: [
    "聊天与纪事的上下沿渐变模糊，最新消息清晰可读。",
    "放歌、屏幕分享和音频配置的弹窗交互更流畅。",
    "设置导航保持固定，语音转文字默认使用云端加均衡识别。",
  ],
  details: [
    {
      title: "房间交互",
      items: [
        "聊天输入框聚焦时保持对齐，图片可直接粘贴或拖入。",
        "屏幕分享先打开选择窗口，再扫描来源。关闭音频配置后保留麦克风菜单。",
        "切换电话状态时，移除麦克风与扬声器按钮的额外闪烁。",
      ],
    },
    {
      title: "设置",
      items: ["展开模型与 API 配置时自动滚动至对应区域。", "管理员功能移至关于上号的维护工具。"],
    },
  ],
};
