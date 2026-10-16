# ShangHao v3.4.7 发布核对

## 版本范围

- 目标版本：3.4.7；构建号：2026.10.16.1；协议维持 7。
- 范围：录音库重复标记区域与回放误写修复、进入房间期间推迟可选视觉预热、自动录音提示音去叠加、麦克风采集请求有界等待。
- 录音库模型评测及其他未完成本地资料不纳入本版。

## 验证

- `corepack pnpm release:verify -- 3.4.7`、`corepack pnpm typecheck` 通过。
- 桌面 smoke：1054 项，1053 通过、1 项跳过、0 失败。
- ESLint 通过；定向 Prettier 检查通过。全仓本地格式检查曾被未纳入本版的 `docs/asr-evaluation-plan-2026-10-13.md` 拦住，Release CI 在提交内容上完整 lint 通过。
- GitHub Release 工作流 `38830792951` 成功，包含原生、电话麦克风、迁移、升级、Runtime、AudioWorklet、屏幕采集、五人音频/媒体、构建、Windows NSIS、包体预算及校验文件检查。
- GitHub [v3.4.7 Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.7) 已公开，提交 `5923521`，构建号 `2026.10.16.1`，协议 7。正式 Windows 安装器 193229513 字节，SHA-256 `34cdf25de65205491ed4e92a0b03b0c8c71db2a4b9f18d03454911afaa00b3b8`；解压目录 510098083 字节，app.asar 59793177 字节，符合包体预算。
- CloudBase 版本目录上传、一致性核验、manifest 激活及首页部署完成。公开首页与 `release.json` 返回 200，manifest 指向 v3.4.7 与同一安装器 SHA-256；官网安装器 HEAD 返回 200，大小 193229513 字节。完整公开安装器哈希复核将在历史档案下载流程保存 v3.4.7 包时一并完成。
- Relay 健康检查：协议 7、构建号 `2026.10.16.1`、在线房间 0；当前 `packageVersion` 字段仍报告 3.4.6。本轮客户端变更不涉及信令协议，未重启 Relay。

## 实机边界

- 隔离 Electron 回归与代码级验证不代表真实房间帧时间、RØDE/第三方设备占用或旧版本原位升级已经通过。
- 不删除历史 Releases、标签、安装包或用户数据。历史版本清理仅提供建议，留待用户自行决策。
