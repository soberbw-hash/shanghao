# 上号 ShangHao

![上号图标](./docs/branding/github-avatar.png)

给 3–5 个固定好友使用的轻量桌面开黑语音频道。没有账号、没有公会、没有复杂房间：打开上号，输入同一个频道码，就能看到谁在线并直接语音。

## 推荐玩法：固定开黑频道

1. 在常驻服务器运行上号信令服务。
2. 在服务端配置一个只告诉好友的 `CHANNEL_ACCESS_CODE`。
3. 每位好友在客户端高级连接里填写同一个频道服务器地址。
4. 打开软件，点击“进入频道”。

固定频道 `main` 会一直存在，没有房主；第一个人退出后频道也不会消失。客户端只保留服务器连接，不再包含房主直连、Tailscale 或临时公网入口。

## 这版重点

- `join_channel / channel_snapshot / leave_channel` 固定频道协议
- 3–5 人独立 WebRTC mesh，失败时自动切换服务端音频转发
- 音频流 session/epoch 隔离、自动 resync、WebSocket 背压丢帧
- ping/pong 延迟估算与长连接自动重连
- 5 个轻量内置动物头像，不再上传大图
- 独立 `audio-timeline.json` 诊断时间线

## 下载

在 [GitHub Releases](https://github.com/soberbw-hash/shanghao/releases) 下载：

- Windows：`ShangHao-版本-Setup-x64.exe`
- Apple Silicon Mac：`ShangHao-版本-mac-arm64.dmg`
- Intel Mac：`ShangHao-版本-mac-x64.dmg`

macOS 测试包当前未签名，首次打开可在 Finder 中右键应用并选择“打开”。

## 部署固定频道

```bash
corepack enable
corepack pnpm install --frozen-lockfile
copy .env.example .env
corepack pnpm relay:start
```

`.env` 示例：

```dotenv
CHANNEL_ACCESS_CODE=change-me
PORT=43821
ROOM_NAME=ShangHao
```

真实频道码不要提交到 GitHub。公网长期使用建议通过域名和 TLS 暴露为 `wss://voice.example.com`。

详细服务器步骤见 [自部署上号云中继](./docs/deploy-relay-server.md)。

## 开发与验证

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm --dir apps/desktop test:smoke
corepack pnpm test:three-peer-audio
corepack pnpm dist:win
```

`test:three-peer-audio` 会自动创建 A/B/C 三个客户端，验证每个人的音频都能路由给另外两个人，并验证第三人退出后 A/B 仍可继续收音。

## 诊断

设置页可一键导出诊断包，其中包括版本、连接状态、最近重连、每位好友的音频状态，以及独立的 `audio-timeline.json`。日志不会记录频道码、音频数据、完整 SDP 或大段信令 payload。

## 技术栈

Electron、React、TypeScript、Vite、Tailwind CSS、Framer Motion、Zustand、Node.js、ws、WebRTC 纯音频。
