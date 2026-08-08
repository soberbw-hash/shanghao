export interface ReleaseHistoryEntry {
  version: string;
  date: string;
  title: string;
  highlights: readonly string[];
}

export const RELEASE_HISTORY: readonly ReleaseHistoryEntry[] = [
  {
    version: "2.4.0",
    date: "2026-08-08",
    title: "五人语音与日常稳定性",
    highlights: [
      "五人房间继续加强互听、晚加入和断线恢复。",
      "语音兜底只在需要时启用，弱网下更省带宽。",
      "开机进入、自动录音、屏幕分享和 Windows 网络修复更可靠。",
    ],
  },
  {
    version: "2.3.0",
    date: "2026-08-02",
    title: "设备、屏幕分享与会话恢复",
    highlights: [
      "修复重开软件后的幽灵成员和音频残留。",
      "进入频道前可检查设备，虚拟麦克风兼容更好。",
      "角色换座可打断，悬浮窗与频道珍藏体验补齐。",
    ],
  },
  {
    version: "2.2.2",
    date: "2026-08-01",
    title: "第四、第五位好友互听修复",
    highlights: [
      "不再只看网络包到达，继续确认声音已经真正解码播放。",
      "五人房间的 20 条声音方向全部加入自动验证。",
      "昵称校验补齐数字、分隔符和常见变形绕过。",
    ],
  },
  {
    version: "2.2.1",
    date: "2026-07-31",
    title: "游戏识别扩展",
    highlights: [
      "KK 平台后台运行不再被误判为正在游戏。",
      "补充更多常见游戏，并为未配置封面的游戏提供稳定图标。",
      "游戏检测保持只读，不注入、不模拟输入、不读取游戏内存。",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-07-30",
    title: "五人语音与降噪基础升级",
    highlights: [
      "建立五个真实客户端的 WebRTC 媒体验收。",
      "单个成员异常时优先修复自己的连接，不重置整个房间。",
      "降噪、屏幕分享和网络质量显示进一步收口。",
    ],
  },
] as const;

export const getReleaseHistoryEntry = (version: string): ReleaseHistoryEntry =>
  RELEASE_HISTORY.find((entry) => entry.version === version) ?? RELEASE_HISTORY[0]!;
