import type { ReleaseHistoryEntry } from "./releaseHistory";

export const RELEASE_3418: ReleaseHistoryEntry = {
  version: "3.4.18",
  date: "2026-11-05",
  title: "语音 AI 与转录可靠性升级",
  summary: "加强转录时间轴、任务隔离和录音回溯体验。",
  highlights: [
    "ASR 任务取消、模型切换和迟到结果处理更可靠。",
    "融合稿保留来源与不确定内容，回溯录音支持关联文字稿。",
    "新安装默认开启自动转录；开发版二次启动尝试恢复主窗口。",
  ],
  details: [
    {
      title: "转录与回溯",
      items: [
        "时间轴无法对齐时保留原文并标出回退片段，冲突稿需要回听复核。",
        "新增游戏语境与分成员回溯辅助，回溯文字稿在本机保存。",
        "模型对比支持参考稿导入和导出，超出预算时不生成不完整分数。",
      ],
    },
    {
      title: "云端文字模型",
      items: [
        "服务端支持 DeepSeek V4.1 Flash 主模型及 GLM 备用配置。",
        "是否启用取决于服务器密钥与部署状态；未配置密钥时继续使用当前服务端配置。",
      ],
    },
  ],
};
