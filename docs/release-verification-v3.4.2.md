# ShangHao v3.4.2 发布核对

2026-10-03 按用户授权及桌面发布流程，核对 GitHub、CloudBase 官网与服务器均为 3.4.1，目标版本 3.4.2，构建号 2026.10.03.1，协议 7。

本地工作区是唯一基线，保留并合并既有修改。所有 10 月 2 日安装后反馈和 10 月 3 日房间记忆纳入本次发布，详情见 [用户公告](release-notes/v3.4.2.md) 和 [剩余工作](remaining-work.md)。

## 发布状态

本地门禁通过：typecheck、Lint/格式、构建、Rust fmt/测试、手机麦克风侧链、迁移、N-1 存储、运行健康、音频 Worklet、屏幕捕获、五人音频和媒体恢复。Smoke 共 989 项，988 通过、1 项原有可选跳过、0 失败。

更新公告改为原生模态对话框，首屏五条重点、按主题展开详情；键盘焦点由浏览器管理，关闭后记录已看版本，可从历史记录重看。隔离 Electron 11 项检查通过，390px 窄窗口正文可滚动且底部确认可见。GitHub 截图来自当前生产组件，使用虚构资料。

最后复核修复了头像接口的自定义图片兼容分支，并检查自定义图片限流与内置头像限流互不干扰。格式化后新增的本地标记职责按模块拆分，保留原有架构预算，没有抬高既有上限。

本地候选安装包 175,363,028 字节（167.24 MiB），解压目录 468.33 MiB、ASAR 50.34 MiB，全部预算通过。包内运行时、登录配置、原图来源、字体、音频和原生助手检查通过；主程序为 asInvoker。GitHub 正式构建产物将单独下载并核验，不使用本地哈希代替。

## 服务端

发布代码为 `ccb034975ba1430f8dc8e0100524cfbaa62e544d`。服务端已部署 3.4.2 / 2026.10.03.1，协议维持 7。部署前无在线房间成员或手机麦克风会话，备份位于 `/root/shanghao/.codex-backups/release-v3.4.2-20261002T171648Z`。六个既有数据文件 SHA-256 一致，没有重置聊天、房间、日报或头像资料。

部署后 Nginx、TURN、手机麦克风服务正常，Relay 在线。公开 HTTPS 三次健康采样、手机页面、房间目录匿名拒绝、房间记忆匿名及无效凭据拒绝通过。

使用独立临时文件、虚构账号和虚构摘要运行当前部署代码，真实云端模型检查通过：房主手动保存、成员加入前拒绝／加入后读取、第二房间访问拒绝、摘要持久上传 ACK、两条有依据的自动事实提取、问答同时读取手动与自动记忆。第二房间未被提取任务写入。结果保存在 `test-artifacts/v342-cloud-fixture.log`；这不是两个真实客户端的跨设备验收。

## GitHub 与官网

[CI](https://github.com/soberbw-hash/shanghao/actions/runs/37039578811)、[CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/37039578736)和 [15 分钟稳定性检查](https://github.com/soberbw-hash/shanghao/actions/runs/37039579780)全部通过。稳定性检查完成 94 轮五人音频与故障回归，并通过最后的五人媒体检查；诊断产物已下载留存。

标签 `v3.4.2` 指向上述发布代码；[正式 Release 构建](https://github.com/soberbw-hash/shanghao/actions/runs/37041481259)全部通过，[正式版本](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.2)于 2026-10-02 17:40:17 UTC 发布。Windows Smoke 与本地一致：989 项、988 通过、1 原有跳过、0 失败。

五份资产全部实际下载并核对 GitHub digest、大小及版本，`SHA256SUMS.txt` 和 `latest.yml` 两处 SHA-512 一致。正式安装包 **175,345,295 字节（167.22 MiB）**，解压目录 **468.16 MiB**，ASAR **50.16 MiB**，独立体积预算检查通过。正式安装包 SHA-256 为 `cd05bc922136df20d22e27acbaef20e2976b67c61c49527183f97c6c21b23a9c`，与本地构建分别验证。

更新配置指向 `soberbw-hash/shanghao`，关闭退出时自动安装；安装完成下载的新版本仍须用户主动点击。GitHub 项目简介及官网链接已更新，README 与 Release 说明补充新功能截图，六张标签内截图均经 HTTPS 下载比对本地 SHA-256。

## 官网

CloudBase CLI 3.8.5 先上传并验证 `downloads/v3.4.2`，再激活 `release.json`、构建并上传首页；根目录未使用 `--safe`，全程未使用 `--prune`。在线清单为 3.4.2，与本地激活清单一致。

首页与邀请页均为 200，字节哈希与本次构建相同，邀请 JS／CSS 可访问。首页 SHA-256 为 `3a565597488b788684713efff8de0824fc79f25fd0e92627ffd3715e3b57fce0`。从官网完整下载 **175,345,295 字节**安装包，SHA-256 与 GitHub 正式资产一致；镜像校验文件一致，旧版 3.4.1 安装包继续返回 200，大小仍为 175,324,213 字节。

官网：[上号](https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com)。证据保存在 `test-artifacts/v342-public/{verified,website-verified}.json`、`v342-online-health.json`、`v342-doc-assets.json` 及对应部署日志。逐项用户反馈见 [完成清单](v3.4.2-completion-checklist.md)。

## 仍需真实环境检查

- 旧客户端发现更新、下载、由用户点击安装并重启。
- 真实五台设备与朋友听感、手机麦克风最终对端听到、系统音频分享。
- 游戏前台全局快捷键、真实挂机及按住静音、无边框游戏悬浮窗、USB 热切换和 Windows 授权成功／取消。
- 两个真实房间的跨设备记忆读取与自然产生的次日总结。

这些边界继承上版，不用隔离自动化冒充已完成的实机结果。
