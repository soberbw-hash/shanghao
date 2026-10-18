# 上号 v3.4.9 发布核对

## 本机验证（2026-10-18）

- 完整 smoke：1079 项，1078 通过、0 失败、1 跳过。跳过项为当前 Windows 环境不支持的私有 pip 构建取消夹具。
- ESLint、Prettier、六个包 TypeScript、素材库 TypeScript、架构预算检查、差异空白检查通过。
- Rust 格式与 2 项原生测试通过；生产构建、203 项素材预览生成通过。
- 电话麦克风、设置迁移、N-1 升级数据、运行健康、实际 Electron 音频 Worklet、屏幕捕获通过。
- 五人音频与媒体回归通过，覆盖 20 条有向链路及故障恢复；这不是五台真实机器的听感验收。
- Electron 助手动画普通/减少动态效果两种模式均通过，每种采样 57 帧；覆盖关闭不闪回、重复展开、点击互动。
- Windows 原生 PhoneInput 助手就绪已观察到。工具注入按键没有形成真实系统采样事件，未宣称原生按键或《英雄联盟》全屏/无边框端到端通过。
- GLM 通用请求真实成功；SenseVoice 真实请求返回 HTTP 402 / 30001（账户余额不足）。密钥已在本机加密配置与备份；未随软件发布。
- 本机原始完整转录保留且字节校验一致。共享库合并、跨进程写锁、完整结果优先、外部刷新已有隔离回归；旧正式版未实现新锁，同一录音同时转录仍应避免。
- 主要截图来自隔离视觉夹具，不含真实聊天、账号、密钥或录音；房间画面不代表已建立通话。

## 产物与渠道

第一份本机候选包和体积预算说明见 [体积记录](package-size-v3.4.9.md)。正式公开资产由 [Windows Release 工作流](https://github.com/soberbw-hash/shanghao/actions/runs/39087487814) 重新构建，全部步骤通过；产品代码对应标签提交 `9e8c848c2551e2751eb1135b78efb23c40416c2a`。随后只修正一个测试中的 Windows 路径夹具，主分支 [Linux / Windows CI](https://github.com/soberbw-hash/shanghao/actions/runs/39087931453) 和 CodeQL 全部通过，未改动已发布产品代码。

- [GitHub Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.9)：安装器、ZIP、blockmap、latest.yml、校验文件及体积报告共 6 个资产。正文包含 3 张截图，所有图片公开请求返回 200。
- 安装器：`ShangHao-3.4.9-Setup-x64.exe`，205,229,883 字节，SHA-256 `98eef8c74590f35e3cd17569559949c57136ac3bd6e17fbd9eea88a4cf0d9ac7`。已下载 GitHub 资产核对哈希和 latest.yml 的 SHA-512。
- ZIP：`ShangHao-3.4.9-Windows-x64.zip`，255,574,416 字节，SHA-256 `ff37f60944ff4ff7d464276b38f8eb3c01fc775596703934de94b21f98bda0cb`。已实际下载，204 个条目 CRC 全通过；启动器、app.asar、PhoneInput/PhoneAudio、官方 ICO、字体许可齐全，无根目录 node_modules 或用户 profile。
- 正式体积：安装器 195.72 MiB、安装后 498.43 MiB、app.asar 66.65 MiB。200/520/80 MiB 当前预算及单份 FFmpeg、无多平台插件/源码等资源规则通过；安装器预算变化原因已单独记录。
- [腾讯云官网](https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com/) 首页和 release.json 返回 200，公开 manifest 为 v3.4.9；版本目录先验证上传，再激活 manifest、构建和上传根目录，未使用根目录 --safe 或 --prune。
- 已从腾讯云完整下载 205,229,883 字节安装器，SHA-256 与 GitHub 和 manifest 完全一致，校验文件返回 200；旧 v3.4.8 下载仍返回 200。
- 下载和核验记录保留在本机 `artifacts/releases/v3.4.9/`；正式安装器也保留在 `website/.release-cache/v3.4.9/`。更新需用户主动安装，本次没有替换正在使用的客户端。

## 主要改动位置

- 电话模式：`phone-shortcut.ts`、`phone-input-monitor.ts`、`phone-virtual-key.ts`、`shortcuts.ts` 与 `native/phone-mode/PhoneInput.cs`。
- 共享转录：`ai-storage.ts`、`shared-voice-memory-store.ts`、`voice-memory-store.ts` 与录音库外部刷新逻辑。
- 云端配置：`ai-transcription-provider-store.ts`、`remote-transcription.ts`、`transcription-provider-ipc.ts` 与模型设置组件。
- 助手：`ChatPanelHeader.tsx`、`ChatAssistantWelcome.tsx`、`AssistantBotCompanion.tsx`、状态 Hook、`221`—`225` 样式分片及原始素材映射。
- 开发入口和图标：`development-shortcuts.ts`、`window.ts`、开发启动/安装脚本；发布资源与工作流同步校验。

完整前阶段文件与状态说明见 [AI 与云端检查](ai-assistant-cloud-review-2026-10-18.md) 和 [共享录音检查](shared-recordings-review-2026-10-18.md)。

## 继续保留的边界

英雄联盟独占全屏、无边框、管理员权限与反作弊组合尚需真实游戏验收。未执行会改变当前通话状态的系统级静音循环。未替用户充值或绕过服务商额度限制，也未自动安装新版或重启当前使用中的客户端。
