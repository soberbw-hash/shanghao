# 上号 ShangHao

![上号图标](./docs/branding/github-avatar.png)

给 3–5 个固定好友使用的轻量桌面开黑语音频道。没有账号、没有公会、没有复杂房间：第一次填好固定服务器，之后打开上号，一步进入频道。

## 推荐玩法：固定开黑频道

1. 在常驻服务器运行上号服务。
2. 为跨运营商网络安装 TURN（强烈推荐）。
3. 每位好友第一次打开时填写同一个服务器地址。
4. 以后打开软件，点击“上号”即可进入。

固定频道 `main` 会一直存在，没有房主；第一个人退出后频道也不会消失。客户端只保留服务器连接，不再包含房主直连、Tailscale 或临时公网入口。

## 2.0 动画与稳定性重点

- `join_channel / channel_snapshot / leave_channel` 固定频道协议
- 3–5 人 WebRTC mesh，服务端可下发短期 TURN 凭据
- 第四、第五位好友加入时主动校验双向收音路径，WebRTC 不可用时按成员精确启用语音兜底
- 共享远端音频混音器，减少多人房间的 AudioContext 数量和设备切换故障
- WebRTC 失败自动重新协商，信令断线持续退避重连
- μ-law 低带宽语音兜底、音频 epoch 隔离、自动 resync 与背压丢帧
- ping/pong 延迟估算与房间内连接质量反馈
- Opus FEC/DTX、32 kHz 语音链路与分级弱网自适应
- RNNoise 智能降噪、低切、语音均衡和麦克风环境校准
- 5 个内置动物角色，带八帧交替步态、可打断最短路径、入场和离场动作
- 720p/1080p 屏幕分享、系统音频、直接媒体流和独立可缩放观看窗口
- 统一的非线性动效、动态图标、场景反馈、可读玻璃材质与原生通知
- Toast 自动去重并限制同时显示数量，重连和弹窗不再遮挡核心操作
- 独立 `audio-timeline.json` 诊断时间线
- 回访用户一步上号；内容区与控制区采用克制的分层材质

## 下载

在 [GitHub Releases](https://github.com/soberbw-hash/shanghao/releases) 下载 Windows 安装包：`ShangHao-版本-Setup-x64.exe`。

## 一键部署固定频道

```bash
sudo SHANGHAO_DOMAIN=voice.example.com bash scripts/deploy-relay-ubuntu.sh
```

脚本会使用独立 `shanghao` 用户运行服务、保留已有 `.env`、持久化最近 100 条普通聊天，并配置 systemd 安全限制。提供域名时会自动配置 Caddy，客户端填写：

```text
wss://voice.example.com/?token=服务器生成的RELAY_ACCESS_TOKEN
```

`RELAY_ACCESS_TOKEN` 和 `TURN_SHARED_SECRET` 只保存在服务器；日志与诊断包不会输出它们。公网裸 `ws://` 只用于临时测试。

详细步骤见 [部署固定频道](./docs/deploy-relay-server.md) 与 [部署 TURN](./docs/deploy-turn.md)。

## 开发与验证

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm --dir apps/desktop test:smoke
corepack pnpm test:five-peer-audio
corepack pnpm dist:win
```

`test:five-peer-audio` 会自动创建 A–E 五个客户端，验证每个人的兜底音频都能路由给另外四个人，并验证第五人退出后现有成员仍可继续收音。旧的 `test:three-peer-audio` 命令保留为兼容别名。

## 诊断

设置页可一键导出诊断包，其中包括版本、连接状态、最近重连、TURN 是否可用、每位好友的音频状态，以及独立的 `audio-timeline.json`。日志不会记录 TURN 密钥、音频数据、完整 SDP 或大段信令 payload。

## 技术栈

Electron、React、TypeScript、Vite、Tailwind CSS、Framer Motion、Zustand、Node.js、ws、WebRTC 语音与屏幕媒体。
