# ShangHao v3.4.4 发布核对

2026-10-03 按用户桌面发布文件，核对 GitHub 与 CloudBase 正式版本均为 3.4.3，目标 3.4.4，构建号 2026.10.03.3，协议保持 7。本地未提交修改全部纳入，不以远端覆盖。

## 范围

统一弹窗背景模糊与不透明度、简化每日回顾、修正关于页素材入口布局、加强窗口图标设置、改善麦克风错误提示。云端智谱备用上一阶段已经启用；密钥只存私人配置，不进 Git 或客户端。实现证据见 [本轮记录](readability-cloud-fallback-2026-10-03.md)。

## 发布进度

GitHub 与服务器已发布，官网同步等待腾讯云授权。官网原下载保持可用，不提前激活尚未上传的链接。

## 正式产物与在线核对

- 标签 `v3.4.4` 对应提交 `139c8ef858d2bd732d2a3c2a440c9c7fb5c6b183`；[正式 Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.4) 已发布，非 draft／prerelease。
- [Release](https://github.com/soberbw-hash/shanghao/actions/runs/37129736787)、[CI](https://github.com/soberbw-hash/shanghao/actions/runs/37129735106)、[CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/37129735110) 全部通过。
- 五个公开资产逐项下载核对 GitHub digest／大小／SHA-256 清单，更新 metadata SHA-512 一致；安装包 193,220,178 字节，SHA-256 `539d8ec192cce666cf40546216b6d337a74fbaf3412f37ea4f45ded4c65efc40`。正式体积为安装包 184.27 MiB、解压 486.43 MiB、app.asar 56.99 MiB，全部在既有预算内。
- GitHub 最新正式版本为 3.4.4，更新 provider 保持 `github / soberbw-hash / shanghao`。三张 README 新版截图逐字节核对通过。
- 服务器为 3.4.4／2026.10.03.3、协议 7；更新前无房间／成员／手机会话。备份 `/root/shanghao/.codex-backups/release-v3.4.4-2026-10-03T14-34-30-105Z`，六个数据文件 SHA-256 一致，Nginx、TURN、手机麦克风服务正常；云端私人备用凭据保留。
- CloudBase 3.8.5 与 3.8.4 均报告旧登录无效；浏览器授权连续超时。`release:prepare` 已校验正式安装包，但版本目录尚未上传，未执行 activate／首页部署。官网 metadata 只读核对仍为 3.4.3；已请求用户完成登录，之后继续上传、激活并核对官网整包下载及旧版链接。

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
