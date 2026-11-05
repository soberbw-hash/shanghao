# ShangHao v3.4.18 发布候选核验

日期：2026-11-05。此记录核验的是候选，不代表已合并、发布或部署。

## 代码与自动化验证

- PR：[soberbw-hash/shanghao#36](https://github.com/soberbw-hash/shanghao/pull/36)，目标为 `main`；最新本地文件树与 PR head 的 Git tree SHA 一致。分支仍未合并。
- 桌面全量 smoke：1732 通过、0 失败、5 跳过（最终 source-junction 回归测试加入前）。该测试加入后，`voice-memory-source-integrity.test.ts` 定向测试 3 项通过，包含 Windows 父目录 junction 拒绝；桌面 TypeScript 编译通过。
- 其余候选验证包括工作区类型检查、ESLint、Prettier、Rust 17 项、构建、五人房间媒体与音频脚本；完整结果以 PR 最新 head 的 GitHub Actions 为准。
- 首轮 CI 揭示两项问题：冻结安装的 lockfile peer 设置与 `.npmrc` 不一致；Windows 测试发现规范路径字符串比较误拒绝合法路径。已分别修正锁文件设置和路径校验，并补充 junction 回归测试。最终 head 的完整 CI 尚待通过。
- 独立「上号审核」针对最新提交做了只读增量复核，没有确认的 P0/P1/P2/P3；真实多人、长通话及用户机器体验仍未验证。

## Windows 候选包

- 构建输出：`apps/desktop/release/v3.4.18-final-candidate/`，独立于旧候选目录。
- 安装包：`ShangHao-3.4.18-Setup-x64.exe`，226,221,124 字节（约 215.74 MiB），超过 200 MiB 建议值约 15.74 MiB；其他现有体积限制通过。
- Packaged runtime 资源检查、Windows 执行级别检查、3.4.18 发布元数据检查均通过。
- 当前安装包未签名（Authenticode `NotSigned`）。候选 SHA-256：
  - 安装包：`702da27e5b8e5b77775e50b471395543af8d516c5250568d51f8a41362a62d9c`
  - Blockmap：`41c17a4581e1635c3191dc0b150e5ba61b9e37c0cce5e9d1208e79d17289f1d0`
  - `latest.yml`：`615614466f66ff5b2d00a4dd3a0b957f361a4cfe9ec460160aebcee4297f0ad8`
  - Package size report：`a53c554e17d65fa4e3eca7a77d0c8a5060aedfa59be9601bd8ef9bc58e65402d`

## DeepSeek 与云端状态

- DeepSeek API key 从用户桌面私有资料文件直接读取，密钥本身未输出、写入仓库、日志或候选包。
- 对官方 `https://api.deepseek.com/models` 执行只读请求，HTTP 200，返回 `deepseek-flash` 与 `deepseek-v4-pro`。本地预设 `deepseek-flash` 对应项目所用 V4.1 Flash。
- 生产服务器尚未部署 DeepSeek：现有 `上号服务器.pem` 对目标服务器的 `shanghao-deploy`、`root`、`ubuntu`、`admin` 均未通过 SSH 认证；线上 `/api/ai/admin/providers` 对现有管理员凭据返回 403。未修改生产配置、未重启服务。
- 因线上配置可优先于首次环境引导，代码的默认路由不能证明当前线上已经切换到 DeepSeek。启用需要获得有效服务器授权后保存 DeepSeek 主模型，并核实 GLM 备用凭据与回退路径。

## 发布边界

- 未创建 `v3.4.18` 标签，未触发正式 Release，未上传候选资产，未更新 CloudBase 官网或部署云服务器。
- 当前候选包仅用于离线验证；未安装到用户环境。真实设备、多房间隔离、长录音续录、屏幕分享负载及旧版本升级仍需另行验收。
- 下一步：最新 head 的 `verify`、`verify-windows`、`analyze` 全部成功；生产服务器身份可用并完成 DeepSeek/GLM 配置与只读健康核验；再按已授权的 PR 与正式发布流程继续。
