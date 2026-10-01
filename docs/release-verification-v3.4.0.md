# ShangHao v3.4.0 发布核对

核对日期：2026-10-01。发布前 GitHub 最新正式版与 CloudBase 官网均为 v3.3.1。本次按用户明确指定发布 **3.4.0**，不采用桌面流程的默认补丁递增。本地工作区为唯一发布基线；深入架构与权限审查留到后续。

## 来源与正式产物

- 标签 `v3.4.0` 指向 `2dd219e7186fe18bbaec8a5420a7bd759b0ec3cf`；README、版本、构建号 `2026.10.01.1`、CHANGELOG 与更新公告一致。
- [GitHub Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.0)由 Actions 构建并发布，包含安装包、blockmap、`latest.yml`、`SHA256SUMS.txt` 与 `package-size.json`。
- 正式安装包 171,651,229 字节（163.70 MiB）；解压目录 486,970,784 字节（464.41 MiB），体积预算通过。仅包含一份 FFmpeg，未增加大型 SDK 或模型。
- 安装包 SHA-256：`70965e9b7105ee8b1a8ec4cf7c7ce5fdeba6af9e5ba51266a0f13d6585842710`。
- 全部五份资产已下载并核对 GitHub digest；校验清单、更新元数据 SHA-512、版本、文件名与字节数一致。

## 验证

- 本地类型、Lint、smoke 与普通构建通过。发布前增加旧官方地址迁移、升级门禁优先于房间查找，以及公共 HTTP 调用者不能伪造 TLS 头的定向测试。
- 正式 Windows Release 的 smoke 为 851 项：850 通过、0 失败、1 原有可选实验跳过。
- [CI](https://github.com/soberbw-hash/shanghao/actions/runs/36794730481)、[CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/36794730535)与 [Release](https://github.com/soberbw-hash/shanghao/actions/runs/36794800493)通过。Release 覆盖 Native、迁移、旧版存储夹具、Runtime、手机麦克风侧链、音频 Worklet、Electron 屏幕捕获、五人音频与媒体恢复、构建及安装包静态校验。
- [15 分钟耐久检查](https://github.com/soberbw-hash/shanghao/actions/runs/36794800427)通过：91 轮五人音频与故障回归，最终五人媒体恢复检查 `recoveryVerified: true`。这是自动化证据，不代表数小时真实挂机或实际设备听感。
- 本地并行验证曾使 FFmpeg 五秒启动探测超时；单独运行该测试与串行 smoke 均通过，没有把主机负载导致的测试超时改成放宽媒体保护。

## 私人房间服务器

- 发布客户端前已部署同一提交的服务端及共享模块，采用校验过的本地构建上传。传输归档 SHA-256：`5ea9cae8be316ecdb126c9e0fa52ce5ac8abb16478bf8384dea6274676aa58ac`。
- PM2 单实例，正式环境目录 `/root/shanghao/data/private-rooms.json`，仅首次写入才创建文件；聊天与报告使用持久化目录。最低客户端版本为 3.4.0。
- 官方入口为 `wss://118.25.103.107/`；Nginx 将 HTTPS 账号、私人房间 API 和 WSS 转发至原信令服务，保留手机麦克风侧链及 TURN 配置。
- 部署前确认没有在线成员，停服后备份并逐文件校验已有报告数据。配置、旧构建与数据备份位于服务器 `/root/shanghao/.codex-backups/release-v3.4.0-2026-10-01T00-11-41-688Z`，不公开其中内容。
- 公网 TLS 校验、健康版本 3.4.0、账号状态、未登录房间 API 拒绝和未登录 WebSocket 4401 均正常；Nginx、手机麦克风和 TURN 服务保持运行，手机页面返回 200。
- 隔离 HTTP/WebSocket 测试验证创建、五人容量、房间隔离、管理、封禁和重启持久化。未拿真实账号、房间或录音做破坏性夹具；上述生产健康检查不代表真实登录账号的完整使用体验已验收。

## 官网

- 按 `website/README.md` 先校验并上传 `downloads/v3.4.0`，再激活清单、构建和部署首页；根目录未使用 `--safe`，未清理旧下载。
- 在线 `release.json` 为 v3.4.0，镜像路径、大小与哈希一致。首页返回 200，SHA-256 与本次构建一致。
- 从官网实际完整下载 171,651,229 字节安装包，其 SHA-256 与 GitHub 正式资产一致；镜像校验文件正常，v3.3.1 的旧安装包仍可访问且大小正确。
- 发现本地 `public/downloads` 中的旧 3.1.0 安装包被重复复制进首页构建，拖慢根目录上传。官网构建改为单独复制公共资源并排除下载目录；构建检查确认旧本地文件仍在、新下载链接正确，线上历史下载也保留。此修复只影响网站构建，未修改已发布客户端。

## 保留的边界

- 已安装旧客户端发现更新、下载完成、用户点击安装并重启；未自动安装到真实用户环境。
- 真实账号多人私人房间切换、五台设备、手机麦克风远端听感、USB 热切换、屏幕 Viewer、系统音频与数小时挂机。
- 完整后台重任务调度、真实显存容量判定与普通权限运行/固定命令提权迁移仍留待后续深入审查。本版没有宣称这些已经实现。
- 没有删除、重置或覆盖真实聊天、账号、录音、Marker、模型、转录与用户设置。
