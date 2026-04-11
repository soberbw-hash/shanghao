# 上号

上号是一款给 3 到 5 位固定好友使用的桌面端开黑语音工具，首发平台是 Windows。

它只做一件事：朋友喊一声“上号”，大家打开软件就能进语音。

## 它适合谁

- 固定好友的小圈子
- 平时不常驻，需要时再打开
- 想要一个比大型社交语音平台更干净、更克制的桌面工具
- 愿意优先通过 Tailscale 在私网环境里使用

## 它不做什么

- 不做频道树
- 不做文字聊天
- 不做好友系统
- 不做公会和服务器广场
- 不做账号注册登录
- 不做复杂商业化能力

## 当前版本已有能力

- Electron + React + TypeScript + Vite 桌面端工程
- 固定 1 个房间，最多 5 人语音
- 房主本地开启 signaling，好友粘贴地址加入
- WebRTC 纯音频 P2P mesh
- 麦克风静音、自由麦、按键说话
- 输入设备 / 输出设备切换
- 说话状态高亮
- 断线自动重连
- Tailscale 检测与引导
- 手动开始 / 停止录音
- 录音导出 `.m4a / AAC`
- 托盘常驻、全局静音快捷键、日志导出

## 首次使用

1. 第一次打开时，先填写昵称并选择头像。
2. 房主点击“开启房间”。
3. 房主把邀请地址发给朋友。
4. 朋友把地址粘贴到首页右侧，点击“加入房间”。
5. 底部控制区可以静音、切换自由麦 / 按键说话、选择音频设备。

## 下载与安装

推荐直接从 GitHub Releases 下载 Windows 安装包：

- 安装包文件名：`ShangHao-Setup.exe`

本地打包后，安装包输出目录是：

- `apps/desktop/release`

## 本地开发

先准备环境：

- Node.js 20+
- pnpm 10+
- Git
- Tailscale

推荐先跑一次环境检查：

```powershell
./scripts/check-environment.ps1
```

安装依赖并启动：

```powershell
pnpm install
pnpm dev
```

## 打包安装包

```powershell
pnpm install
pnpm dist
```

输出文件：

- `apps/desktop/release/ShangHao-Setup.exe`

## 录音说明

- 录音不会自动开始，必须手动点击
- 录音状态会在房间页明显显示
- 程序会优先尝试直接导出 AAC
- 如果运行环境不支持直接 AAC，会自动走中间格式再转码
- 导出失败时会保留临时文件，方便排查

## 仓库结构

```text
shanghao/
├─ apps/
│  └─ desktop/
├─ packages/
│  ├─ recording/
│  ├─ shared/
│  ├─ signaling/
│  ├─ ui/
│  └─ webrtc/
├─ docs/
├─ scripts/
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ tsconfig.base.json
```

## 技术栈

- Electron
- React
- TypeScript
- Vite
- pnpm workspace
- Tailwind CSS
- Framer Motion
- Zustand
- Node.js + TypeScript + ws
- WebRTC 纯音频 P2P mesh
