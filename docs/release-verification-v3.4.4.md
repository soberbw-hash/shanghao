# ShangHao v3.4.4 发布核对

2026-10-03 按用户桌面发布文件，核对 GitHub 与 CloudBase 正式版本均为 3.4.3，目标 3.4.4，构建号 2026.10.03.3，协议保持 7。本地未提交修改全部纳入，不以远端覆盖。

## 范围

统一弹窗背景模糊与不透明度、简化每日回顾、修正关于页素材入口布局、加强窗口图标设置、改善麦克风错误提示。云端智谱备用上一阶段已经启用；密钥只存私人配置，不进 Git 或客户端。实现证据见 [本轮记录](readability-cloud-fallback-2026-10-03.md)。

## 发布进度

GitHub、官网与服务器全部完成 3.4.4 发布。先核验公开 GitHub 产物，再上传官网版本目录，最后激活 metadata 并部署首页，历史下载保留。

## 正式产物与在线核对

- 标签 `v3.4.4` 对应提交 `139c8ef858d2bd732d2a3c2a440c9c7fb5c6b183`；[正式 Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.4) 已发布，非 draft／prerelease。
- [Release](https://github.com/soberbw-hash/shanghao/actions/runs/37129736787)、[CI](https://github.com/soberbw-hash/shanghao/actions/runs/37129735106)、[CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/37129735110) 全部通过。
- 五个公开资产逐项下载核对 GitHub digest／大小／SHA-256 清单，更新 metadata SHA-512 一致；安装包 193,220,178 字节，SHA-256 `539d8ec192cce666cf40546216b6d337a74fbaf3412f37ea4f45ded4c65efc40`。正式体积为安装包 184.27 MiB、解压 486.43 MiB、app.asar 56.99 MiB，全部在既有预算内。
- GitHub 最新正式版本为 3.4.4，更新 provider 保持 `github / soberbw-hash / shanghao`。三张 README 新版截图逐字节核对通过。
- 服务器为 3.4.4／2026.10.03.3、协议 7；更新前无房间／成员／手机会话。备份 `/root/shanghao/.codex-backups/release-v3.4.4-2026-10-03T14-34-30-105Z`，六个数据文件 SHA-256 一致，Nginx、TURN、手机麦克风服务正常；云端私人备用凭据保留。
- CloudBase 旧登录失效，用户通过新的官方 device flow 完成授权后，3.8.4 CLI 上传版本目录并完成 safe 一致性核对，再执行 activate／网站构建／根目录部署。根目录未使用 safe 回滚，未 prune。官网完整重下载的安装包 SHA-256 与正式 GitHub 产物一致，网站 metadata 为 3.4.4。
- 官网首页、release.json、下载页、邀请页逐字节对照本地构建通过；官网校验文件一致，3.4.3 历史安装包返回 200 且大小保持 193,215,389 字节。发布记录补充提交 `7bf7f16` 的 [CI](https://github.com/soberbw-hash/shanghao/actions/runs/37131697318) 与 [CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/37131697304) 通过。

## 本地门禁

- Typecheck、ESLint、Prettier、原生格式及测试、架构预算检查通过。关于页卡片样式独立为具名 CSS 文件，没有抬高既有模块预算。
- 全量 Smoke：1002 项，1001 通过，1 跳过，0 失败。手机麦克风 10 项、迁移 35 项、N-1 升级夹具、Runtime Health 均通过。
- Audio Worklet、Screen Capture、五人语音、五人媒体及恢复自动化通过；不代表真实设备听感验收。
- 打包素材审核工具及编译后 app.asar 独立入口检查通过，使用隔离 profile。
- 候选包约 184.28 MiB，解压约 486.60 MiB，app.asar 约 57.17 MiB；去掉素材窗口 PNG 重复副本，复用同一原始图标。正式 CI 产物另行核对。
- GitHub 新版截图来自实际组件的虚构内容夹具，包括每日回顾、关于页和更新公告。

## 继承的实机边界

- 旧客户端发现更新、下载、用户点击安装并重启。
- 实际任务栏图标和 Windows 固定项缓存。
- 真实设备麦克风采集与远端听感、五台设备语音及屏幕声音。
- 真实房间摘要生成的次日回顾质量。
