import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_349: ReleaseHistoryEntry = {
  version: "3.4.9",
  date: "2026-10-18",
  title: "电话快捷键与 AI 助手",
  summary: "补强游戏中的电话模式按键，加入可互动的小助手与云端转录，共用已有转录结果。",
  highlights: [
    "Windows 原生按键检测补充原监听，游戏中按着 Shift、Ctrl 仍可触发电话模式。",
    "AI 助手原地展开提问，支持柔和跟随、点击打招呼和真实请求状态反馈。",
    "文本与转录模型分开选择，支持 SenseVoiceSmall 云端及自定义接口。",
    "正式版与开发版共用录音和转录，保留完整结果并备份旧数据。",
  ],
  details: [
    {
      title: "电话模式",
      items: [
        "按键监听与独立 Windows 检测按时间去重，补充丢松键恢复。",
        "原生助手异常时保留隐私静音；实际游戏全屏与反作弊环境仍需独立确认。",
      ],
    },
    {
      title: "AI 与数据",
      items: [
        "云端使用自己的密钥，录音只在主动转录时上传。",
        "SenseVoice 返回纯文本与估算时间轴，服务可用性受账户额度限制。",
        "本地模型、原始录音、转录结果及吉祥物原始素材继续保留。",
      ],
    },
  ],
};

export const RELEASES_346_TO_348: readonly ReleaseHistoryEntry[] = [
  {
    version: "3.4.8",
    date: "2026-10-17",
    title: "本地模型准备与快捷键启动",
    highlights: ["修复受管 Python Runtime 准备与重试。", "全局按键监听先于钩子启动完成注册。"],
    details: [
      {
        title: "修复",
        items: ["修复受管 Python Runtime 准备与重试。", "全局按键监听先于钩子启动完成注册。"],
      },
    ],
  },
  {
    version: "3.4.7",
    date: "2026-10-16",
    title: "录音标记与进房体验",
    highlights: ["修复录音库标记重复与组件复用。", "优化进房预热与麦克风采集等待。"],
    details: [
      {
        title: "修复",
        items: ["修复录音库标记重复与组件复用。", "优化进房预热与麦克风采集等待。"],
      },
    ],
  },
  {
    version: "3.4.6",
    date: "2026-10-11",
    title: "声音、启动与设备恢复",
    highlights: ["完善快捷消息音量、启动准备及设备恢复。"],
    details: [{ title: "修复", items: ["完善快捷消息音量、启动准备及设备恢复。"] }],
  },
];
