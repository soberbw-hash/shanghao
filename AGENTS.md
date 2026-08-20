# ShangHao 长期开发规则

本仓库的本地工作区是唯一最新基线。开始开发前必须先阅读 `git status`、`git diff`、
`git diff --staged`，保留并合并所有现有修改。GitHub 远端可能落后，不能用远端内容
覆盖本地文件。

## 禁止操作

- 不运行 `git reset --hard`、`git checkout --`、`git clean`，不重新 clone 或重建项目。
- 未经用户明确要求，不 push、tag、创建 Release、部署服务器、打包 EXE 或修改正式版本号。
- 不删除或重置用户设置、聊天、录音、Marker、模型、转录数据和已下载资源。
- 手工源文件修改使用 `apply_patch`；格式化和明确的批量机械转换可使用专用命令。

## 稳定性优先级

1. 五人语音、后加入成员音频、Mesh/ICE/TURN/Relay 恢复。
2. AEC、DeepFilter、VAD、Double Talk、人声保护、独立音量和响度平衡。
3. 一号房/二号房隔离，聊天 ACK/重试/去重，屏幕分享和录音完整性。
4. 所有用户本地数据与 UI/角色资源兼容性。

不要为了重构指标改写已验证的实时媒体路径。出现网络或音频问题时，先按成员、按链路
定位，避免全房重连或全局重置。

## 3.0 架构边界

- Electron/React/TypeScript/Vite/Tailwind/Zustand/ws/WebRTC 技术栈保持不变。
- Renderer 通过显式、类型化的 `shanghaoCore.*` 能力逐步访问主进程；禁止万能
  `invoke(channel, payload)` 接口。
- Rust Core 只承担适合原生层的 Windows 活动查询、稳定文件身份、元数据事务和
  AI 子进程生命周期监督。WebRTC、DeepFilter、VAD 和模型算法继续留在现有实现。
- 平台差异集中在 `PlatformService`；Windows 是正式支持平台，macOS 保留清晰的
  能力降级边界。
- `ScreenCaptureService` 是主进程屏幕源枚举、选择和内容保护的统一入口；
  `ScreenShareManager` 仍是分享 Track 的唯一所有者。
- 视觉动画必须遵守 `docs/motion-guidelines.md`；纯视觉任务在页面隐藏后暂停，
  实时连接、音频、录音和信令不得随视觉生命周期暂停。
- VibeVoice 与 Qwen 使用运行时清单固定的仓库/修订；不以占位输出冒充真实推理。

## 数据、诊断与更新

- 数据格式升级必须向后兼容，并在写入前提供可校验、原子提交的迁移/快照路径。
- 诊断默认只记录运行状态和有界统计，不记录聊天正文、转录正文、音频内容或凭据。
- 更新只允许后台下载；下载完成后必须由用户明确点击才安装并重启。
- 信令协议变更必须保持旧客户端可安全拒绝或降级，不能让未知消息破坏会话。

## 验证命令

优先运行与改动相关的最小验证，完成一个阶段后再运行全量验证：

```powershell
corepack pnpm typecheck
corepack pnpm --dir apps/desktop test:smoke
corepack pnpm test:five-peer-audio
corepack pnpm test:five-peer-media
corepack pnpm build
cargo test --manifest-path native/Cargo.toml --workspace
```

开发阶段以热更新和真实设备验证为主。除非用户明确要求，不运行 `dist`、`dist:win`
或任何发布工作流。
