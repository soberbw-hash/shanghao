# 上号

![上号图标](./docs/branding/github-avatar.png)

一句话介绍：朋友喊一声“上号”，大家打开软件，直接进语音。

上号（ShangHao）是一款给固定好友小圈子使用的桌面语音开黑工具，重点就两件事：进房快，状态清楚。它不是大型社交平台，不做频道树、公会、陌生人社交，也不想把简单事情做复杂。

## 现在适合谁

- 只和固定 3–5 个朋友开黑的人
- 想要“打开就用”，不想再开一整套社交软件的人
- 需要更稳的 Tailscale / 直连 / 中继三种手动连接模式的人
- 想要更轻、更克制、更像桌面工具的语音软件的人

## 这版已经能做什么

- 固定一个房间，最多 5 人语音
- 房主开房，好友复制地址加入
- 三种手动连接模式：
  - 房主直连
  - Tailscale
  - 云中继
- 首次启动先填写昵称和头像
- 自由麦 / 按键说话（PTT）
- PTT 自定义按键
- 输入输出设备切换
- 成员说话高亮、单独音量调节
- 手动开始 / 停止录音，导出 `.m4a / AAC`
- 启动兜底、安全模式、日志导出、诊断包导出
- 首页临时聊天，只支持文字和 emoji

## 连接模式怎么选

### 房主直连

适合本机具备公网直连条件时使用。现在会先启动本地房间，再异步检测公网 IP、端口映射和外网可达性。

- 如果检测通过：会提示“公网可达，可直接分享”
- 如果检测失败：房间仍然会先启动，但会明确提示建议切换到 Tailscale 或云中继

### Tailscale

适合固定好友长期使用，优先走 MagicDNS，其次走 100.x 地址。最稳，也最省心。

### 云中继

适合作为复杂网络环境的稳定兜底，不依赖你本机暴露公网端口。

## 首次上手

1. 第一次启动先填昵称和头像
2. 选择连接模式
3. 房主点“开启房间”
4. 把邀请地址发给好友
5. 好友粘贴地址后点“立即加入”

## 体验重点

- 首页只保留高频操作：选模式、开房、加入、看状态
- 房主状态会在顶部横条里一句话显示
- 成员位始终一整排 5 个，不再换行
- 试音移到设置页，首页不再占位
- 固定体验项默认启用，不再塞一堆没必要的开关给用户

## 下载

最新 Windows 安装包在 GitHub Releases：

- [ShangHao-Setup.exe](https://github.com/soberbw-hash/shanghao/releases)

本地打包产物默认输出到：

- `apps/desktop/release`

## 本地开发

### 环境要求

- Node.js 20+
- pnpm 10+
- Git
- Windows 10 / 11

### 安装依赖

```powershell
pnpm install
```

### 启动开发环境

```powershell
pnpm dev
```

### 类型检查

```powershell
pnpm typecheck
```

### 打包安装版

```powershell
pnpm dist
```

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
- Tailwind CSS
- Zustand
- Node.js
- ws
- WebRTC 纯音频

## 诊断与排障

如果遇到启动失败、开房失败、加入失败，优先做这几件事：

1. 到设置页导出日志
2. 到设置页导出诊断包
3. 确认当前连接模式是否选对
4. 房主直连不通时，直接改用 Tailscale 或云中继

诊断包会带上这些内容：

- 版本信息
- 当前连接模式
- 当前邀请地址
- 代理 / TUN 检测结果
- 音频设备摘要
- Tailscale 状态摘要
- direct_host 探测结果
- relay 状态摘要
- 关键日志文件

## 版本说明

当前仓库以 Windows 桌面版为主，后续会继续围绕“稳定、极简、低干扰”的方向打磨，不会往大型社交平台路线走。
