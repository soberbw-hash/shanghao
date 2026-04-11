# 上号

一句话介绍：兄弟喊一声“上号”，大家打开软件，直接进语音。快、轻、安静，不废话。

上号是一个给 3 到 5 个固定好友使用的桌面端开黑语音工具，首发平台是 Windows。
它不是社交平台，不做频道树，不做公会，不做聊天，只做一件事：让熟人小圈子更快进语音。

## 适合谁

- 🎮 打游戏时，不想再开一整套社交软件的人
- 👥 平时就那几个固定朋友，不需要好友系统和频道系统的人
- 🎧 想要一个更干净、更克制、打开就能说话的语音工具的人
- 🌐 愿意优先在 Tailscale 私网环境里稳定使用的人

## 现在能做什么

- ✅ 固定一个房间，最多 5 人同时语音
- ✅ 房主开房，朋友粘贴地址加入
- ✅ 首次启动先填写昵称和头像，进房更容易认人
- ✅ 麦克风静音、自由麦、按键说话
- ✅ 输入设备、输出设备切换
- ✅ 成员说话状态高亮、单独音量调节
- ✅ Tailscale 检测与安装引导
- ✅ 断线自动重连、托盘常驻、全局静音快捷键
- ✅ 手动录音，导出 `.m4a / AAC`
- ✅ 启动失败、安全模式、日志导出这些基础兜底

## 它不做什么

- ❌ 不做文字聊天
- ❌ 不做频道树
- ❌ 不做好友系统
- ❌ 不做公会 / 服务器广场
- ❌ 不做注册登录
- ❌ 不做复杂商业化

## 第一次怎么用

1. 👤 第一次打开时，先填昵称并选择头像。
2. 📡 房主点击“开启房间”。
3. 🔗 把邀请地址发给朋友。
4. 📥 朋友把地址粘贴到首页右侧，点击“立即加入”。
5. 🎙️ 底部控制区可以静音、切换自由麦 / 按键说话、切换音频设备。

## 下载与安装

推荐直接从 GitHub Releases 下载 Windows 安装包：

- `ShangHao-Setup.exe`

本地打包后，安装包输出目录在：

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

- ⏺️ 录音不会自动开始，必须手动点击
- 🔴 录音状态会在房间页清楚显示
- 💾 程序会优先尝试直接导出 AAC
- 🔁 如果运行环境不支持直接 AAC，会自动走中间格式再转码
- 🧾 导出失败时会保留临时文件，方便排查

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
