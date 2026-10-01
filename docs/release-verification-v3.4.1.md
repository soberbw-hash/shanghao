# ShangHao v3.4.1 发布核对

核对日期：2026-10-02。发布前实时核对 GitHub 与 CloudBase 最新正式版均为 3.4.0，按用户指定与桌面发布流程递增为 3.4.1。完整需求清单见 [本轮清单](v3.4.1-completion-checklist.md)。本地工作区为唯一基线，既有修改保留并合并。

## 本地门禁

类型、Lint/格式、构建、Native、迁移、N-1 数据升级、运行健康、手机麦克风侧链、音频 Worklet、屏幕捕获、五人音频、五人媒体解码与恢复通过。Smoke 906 项：905 通过、0 失败、1 原有可选跳过。

原生隔离 UI 检查覆盖完整快捷按钮、迟到音乐停止、暂离姓名、独立悬浮入口的 1/5 人尺寸与置顶状态，以及自动输入恢复的 Owner 隔离。换座覆盖六条路径、五次中断和失败收尾。片段/托盘检查包含真实 M4A 导出、实际播放器时钟、预设与确认持久化、取消及退出资源边界。

本地安装包 175,338,697 字节（167.22 MiB），解压目录 468.23 MiB，ASAR 50.24 MiB；全部预算通过。安装资源中的官方原稿与批准的 `docs/branding/github-avatar.png` 字节一致，九档 ICO 图像逐一在真实 EXE 中找到；独立 `overlay.html` 已入包，EXE 为 asInvoker。正式 GitHub 产物将另外核对，不能假设其哈希与本地包相同。

## 发布进度

服务器已经部署 3.4.1，同构建号 `2026.10.02.1`、协议 7。先确认在线成员与手机输入均为零，再备份原构建、配置和数据；只更新共享/信令构建及启动元数据，既有数据逐文件 SHA-256 保持一致。备份目录 `/root/shanghao/.codex-backups/release-v3.4.1-20261001T213203Z`，归档传输哈希 `926244d50ec61f848d3b002d0958d330252198b589884e5564f64a04b3da761b`。未覆盖 `.env`、房间、账号头像和报告数据。

公网 TLS 健康检查及三个连续样本正常、实时消息丢弃为零；无凭据请求和格式错误 JWT 均返回 401，手机页面为 200，Nginx、TURN 和手机麦克风服务继续运行。原最低版本 3.4.0 保持兼容。

首轮 Windows CI/Release 在两处测试把临时目录的 8.3 短名与完整名称按字符串比较，未发布任何 Release。改为比较真实路径，保留原目录边界、音频探测、源文件保护和原子提交断言；定向五项检查通过。尚未发布的标签更新到 `288f89fe52ad609432bc0108184a98466017ab51` 后重新运行全部门禁。

## GitHub 与更新文件

标签 `v3.4.1` 指向 `288f89fe52ad609432bc0108184a98466017ab51`。更新公告、版本与构建号一致；[正式 Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.1)于 2026-10-01 21:44:09 UTC 发布。

[CI](https://github.com/soberbw-hash/shanghao/actions/runs/36930053002)、[CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/36930052938)与 [Release](https://github.com/soberbw-hash/shanghao/actions/runs/36930085069)全部通过。正式 Windows smoke 为 906 项：905 通过、0 失败、1 原有跳过；Release 包含 Native、手机输入侧链、迁移、旧版存储、运行健康、AudioWorklet、原生屏幕捕获、五人音频/解码媒体恢复、构建、包体积和原图/九档 EXE 图标核查。

五份正式资产均实际下载，GitHub digest、`SHA256SUMS.txt`、`latest.yml` 的两处 SHA-512、文件名、大小及版本逐项一致。正式安装包 **175,324,213 字节（167.20 MiB）**，解压目录 **468.06 MiB**，ASAR **50.06 MiB**，预算通过。正式安装包 SHA-256：`130ce2ebaef4d8790c093d6894d36f637561b248a9ff44c7cf11a4d5bdee252b`。它与本地构建哈希不同，未把本地包冒充正式资产。

## 官网

CloudBase CLI 3.8.5 按文档先上传并验证 `downloads/v3.4.1`，再激活清单、构建和上传首页；根目录未用 `--safe`，全程未用 `--prune`。在线 `release.json` 为 3.4.1，与已激活本地清单一致。

首页与邀请页均为 200，字节哈希与本次构建相同；邀请页引用的 JS/CSS 也可访问。首页 SHA-256：`3a565597488b788684713efff8de0824fc79f25fd0e92627ffd3715e3b57fce0`。从官网实际完整下载 175,324,213 字节安装包，SHA-256 与 GitHub 正式产物一致；镜像校验文件一致，3.4.0 旧安装包仍为 200 且大小保持 171,651,229 字节。

## 原生 UI 检查复用

先运行桌面 `build:main`，再用 Vite 在 `45739` 启动界面（关闭 HMR，预先包含 React、ReactDOM、Framer Motion、GSAP 和 Lucide 依赖）。第二个终端运行 `corepack pnpm --dir apps/desktop exec electron tests/electron-v341-ui-review.cjs`。夹具自动从当前源文件构建悬浮控制器并复制实际 preload，无需预先留下旧测试产物；所有窗口使用独立 profile。结果写入 `test-artifacts/v341-ui-review.json`。

## 保留的真实环境边界

- 无边框英雄联盟内悬浮窗、120/144 Hz 主观流畅度、真实 USB 热切换。
- 真实五台设备、朋友听感、手机麦克风四阶段、分享 Viewer 与系统音频。
- 旧客户端发现更新、下载、用户点击安装并重启；没有覆盖真实用户数据做升级夹具。
- 第三方软件原生拖放、系统通知最终到达、系统操作的 UAC 成功/取消和真实模型显存容量。
- 游戏模式、英雄及队伍人数依赖官方数据源与好友客户端发布；当前扩展游戏检测和表现，不伪造丰富状态。
