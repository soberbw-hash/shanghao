# 上号

上号是一款 Windows 优先的私人开黑语音工具，服务对象就是 3 到 5 位固定好友。

它故意做得很克制：

- 只有一个固定房间
- 只做语音，不做聊天和社交系统
- 房主本地开房，好友通过地址加入
- 优先配合 Tailscale 私网使用
- 录音必须手动开启
- 没有账号、好友列表、频道树和服务器广场

一句话介绍：

> 更好的开黑语音

## 适合谁

- 固定小圈子好友
- 平时不常驻，需要时再打开
- 想要比传统游戏平台语音更干净、更克制的桌面工具
- 不想折腾云服务器和复杂部署

## 当前能力

目前仓库已经完成这些核心能力：

- Electron + React + TypeScript + Vite 的桌面端工程
- 托盘、全局静音快捷键、主进程 IPC、日志落盘
- Tailscale 检测与下载引导
- WebSocket 极简 signaling server
- WebRTC 纯音频 mesh 房间结构
- 输入/输出设备切换
- 自由麦和按键说话
- 说话状态高亮
- 手动录音、`.m4a / AAC` 导出
- Windows 安装包打包链路

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

## 下载安装

推荐直接从 GitHub Releases 下载 Windows 安装包：

- 安装包文件名：`ShangHao-Setup.exe`

如果你是从源码本地打包，安装包会生成在：

- `apps/desktop/release`

## 普通用户怎么用

1. 你和朋友都先安装 `Tailscale`，并登录到同一个 tailnet。
2. 安装并打开 `上号`。
3. 第一次启动时允许麦克风权限。
4. 房主在首页点击“开启房间”。
5. 房主把房间里的邀请地址发给朋友。
6. 朋友在首页输入这个地址，点击“加入房间”。

房间里可以做的事：

- 静音 / 取消静音
- 切换自由麦 / 按键说话
- 切换输入设备 / 输出设备
- 给每个成员单独调音量
- 开始 / 停止录音
- 导出日志方便排查问题

## 本地开发

先准备环境：

- Node.js 20+
- pnpm 10+
- Git
- Tailscale

建议先跑环境检查：

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

输出位置：

- `apps/desktop/release/ShangHao-Setup.exe`

## 录音说明

- 录音不会自动开始，必须手动点击
- 录音状态会在房间页显式显示
- 程序会优先检测是否支持直接 AAC 录音
- 如果运行环境不支持直接 AAC，会走中间格式再转码导出
- 导出失败时会保留临时文件，方便排查

## 当前阶段说明

这是一个可运行、可打包、可继续迭代的首版基础工程。

更准确地说，它已经适合：

- 本地开发
- 双机联调
- 固定好友小范围试用

如果你要正式给朋友长期使用，建议优先验证：

1. 两台以上 Windows 机器上的实际语音稳定性
2. Tailscale 环境下的加入流程
3. 不同麦克风和耳机设备切换
4. 录音导出路径和权限表现

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
