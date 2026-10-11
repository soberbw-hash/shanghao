# 本地图标修复候选包 · 2026-10-11

## 范围

用户明确授权打本地修复版，并确认已经退出房间后允许切换验证。候选包从当前本地工作区构建，保留现有未发布的麦克风、快捷键、诊断及悬浮窗修改；没有覆盖源码、递增版本、推送 Git、创建 Release 或部署。版本仍为 3.4.5，不作为正式 3.4.5 发布包的替代校验依据。

图标改为 Windows 优先读取多尺寸官方 ICO；悬浮窗的隐藏 owner 使用 PlatformService 判定平台，修正全量检查发现的直接 process.platform 访问。官方 PNG 原稿、账号、设置、聊天、录音和模型保留。

## 产物

- 目录：`apps/desktop/release/local-icon-fix-20261011/`
- 安装器：`ShangHao-3.4.5-IconFix-Setup-x64.exe`
- SHA-256：`6b80a598b7839d65c009b018e7172f3f55be5350b1e60d6d217d048e762cd7b8`
- 安装器 184.29 MiB，解压程序 486.63 MiB，app.asar 57.19 MiB；实际候选产物通过体积预算。

## 验证

- 桌面 smoke 1050 通过、1 跳过、0 失败。首次发现平台边界违规，修正后全量重跑通过。
- Desktop 类型检查、相关 ESLint、构建通过。
- 实际包的资源、官方图标九档 EXE 资源、AI runner 哈希、原生助手、字体、DeepFilter、语音素材和许可证校验通过；EXE 仍为 asInvoker。
- 从候选 app.asar 提取实际 getWindowIcon 函数、读取候选 ICO，在隐藏隔离原生窗口中验证 SMALL/BIG 为当前 DPI 的 24/48 px。初次探针因 Electron 对 asar 模块路径的解析失败，已停止仅该测试进程，改用 Electron 原生文件读取后通过。
- 打包首次由直接 node 启动，错误选择 npm 并卡在依赖收集；仅终止该打包进程，使用 pnpm exec 启动后正常完成，禁用发布。

原始日志在忽略目录 `test-artifacts/local-icon-*.log`，体积报告为 `test-artifacts/local-icon-package-size-2026-10-11.json`。

## 实机切换状态

用户确认旧房间已退出后，查询没有旧 ShangHao.exe 进程。打开候选 `win-unpacked/ShangHao.exe`，继续使用原用户配置，账号自动恢复；没有覆盖旧正式版程序或改变桌面快捷方式。实际 HWND 724908 只读取得 SMALL 24 px、BIG 48 px，但用户仍看到原子图标，证明尺寸修正没有单独解决问题。

随后发现开始菜单 `Electron.lnk` 指向仓库裸 Electron 42.11.8，却登记为 `com.sober.shanghao`，与正确的上号入口共用身份。将这个错误入口移出开始菜单并保留原文件，给已有上号开始菜单入口明确设置候选包的官方 ICO，再通知 Shell 入口变化；没有重启上号或 Explorer。用户立即确认任务栏已变成耳机图标。该前后结果支持旧快捷方式身份冲突为本机显示错误的原因，不把单独的 HWND 尺寸检查作为根因证据。

备份位于 `%LOCALAPPDATA%/ShangHao-brand-backups/2026-10-11-shortcut-collision/`：`Electron.lnk` 为移出的原入口，`ShangHao.lnk` 为修改前的正确入口，移出文件的 SHA-256 已核对一致。回退可将两份文件恢复到原开始菜单路径；错误 Electron 入口会重新引入身份冲突。桌面快捷方式仍指向旧正式版，开始菜单上号入口指向候选版；没有安装 NSIS 或覆盖旧程序。

当前候选启动路径与旧版不同，网络规则可能需要 Windows 授权；不会代替用户操作授权框，也不自动加入房间或重启正在进行的录音。快捷消息默认 30% 和实时音量是在此候选打包后新增的源码修改，不在这个安装包中。
