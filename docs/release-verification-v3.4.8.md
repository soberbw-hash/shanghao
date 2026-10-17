# 上号 v3.4.8 发布核对

## 版本范围

- 目标版本：3.4.8；构建号：2026.10.17.1；协议维持 7。
- 范围：修复本地 ASR 模型准备失败后的受管 Python Runtime 初始化与重试、电话模式启动时全局快捷键监听竞态，以及游戏活动状态下的全局按键处理。
- 此版本不包含信令协议变更，因此无需部署或重启 Relay。

## 验证

- 修复发布工作流的架构预算失败：通过复用 `PortablePythonOptions` 移除冗余适配层，`ai-runtime-manager.ts` 从超出预算的 1837 行降至 1823 行，没有提高架构上限。
- 本地定向测试：Portable Python Runtime 与架构守卫 10 项通过；桌面 TypeScript 检查、目标 ESLint/Prettier、`git diff --check`、架构预算检查及 `verify-release-metadata.mjs v3.4.8` 均通过。
- GitHub Actions 发布工作流 [39010486299](https://github.com/soberbw-hash/shanghao/actions/runs/39010486299) 成功，包含测试、构建、Windows NSIS 打包、包体校验、校验和生成及发布。
- [GitHub v3.4.8 Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.8) 已发布。发布代码提交为 `49bb7585032b5097f9bdbb6bc6ad7d05ee415840`，标签 `v3.4.8` 指向该提交。Windows 安装器 `ShangHao-3.4.8-Setup-x64.exe` 大小 193230573 字节，SHA-256 为 `2f7ed79ac3db60d21bb501777d71c2d6fb8052b7de3bafbc6f4e7a7c478adeb5`。
- CloudBase 版本目录上传使用 `--verify --safe` 完成，文件一致性校验成功；随后激活 v3.4.8 manifest 并部署网站根目录。公开首页、`release.json`、安装器 HEAD 与校验和请求均返回 200，清单版本和哈希与 GitHub 一致。安装器 GET 可正常读取，开头字节为 Windows PE 的 `MZ` 标记。
- CloudBase 清单激活记录已提交到 `main`：`26f565b`（`release: activate CloudBase mirror v3.4.8`）。

## 实机边界

- 自动化回归覆盖本地模型 Runtime 准备/重试、快捷键监听顺序及游戏活动抑制路径；没有在每款实际游戏中逐一验证独占全屏、无边框窗口、反作弊软件或不同键盘驱动组合。该项仍需在目标游戏实机确认。
- 未验证从每个历史版本原位升级；本次公开安装器和 CloudBase 镜像已完成发布与读取核验。
- 本机原有 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml` 修改未纳入发布提交，保留为工作区改动。
