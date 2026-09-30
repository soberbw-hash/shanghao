# ShangHao v3.3.1 发布核对

核对日期：2026-09-30。发布前 GitHub 最新正式版与 CloudBase 官网均为 v3.3.0，按桌面《发布.txt》将补丁版本递增到 v3.3.1。本地工作区为发布基线。

## 发布来源与产物

- 标签 `v3.3.1` 指向 `43a68b793c100a3a52c188b98d4dffb271d50183`；README、版本号、构建号、CHANGELOG 与更新公告一致。
- [GitHub Release](https://github.com/soberbw-hash/shanghao/releases/tag/v3.3.1)包含安装包、blockmap、`latest.yml`、`SHA256SUMS.txt` 与 `package-size.json`。
- 正式安装包由 GitHub Actions 构建：171,625,842 字节（163.68 MiB）；解压目录为 486,855,337 字节（464.30 MiB），体积预算通过。
- 正式安装包 SHA-256：`513c133d0471b59a5100859fdc72c1570e287a17ce5db71f3159cb5d9d1ed002`。
- 已下载全部正式资产，核对 GitHub digest、SHA-256 清单；更新元数据的 SHA-512、版本、文件名和字节数与正式安装包一致。
- 本地打包曾停滞在 Electron 下载校验资源，改用已安装的相同固定版本 Electron 42.11.8 完成独立包检查；正式发布仍使用 Actions 的标准构建产物。本地与正式产物的精确大小不混用。

## 验证结果

- 本地类型检查、Lint、smoke、迁移、旧版存储夹具、Runtime 健康、手机麦克风侧链、音频 Worklet、屏幕捕获、五人音频/媒体恢复和构建通过；Rust 格式及两项测试通过。
- 安装包静态检查通过：CloudBase 登录配置、AI Runner 哈希、原生助手、降噪资源、快捷音频、许可证和 Windows 执行级别。
- [CI](https://github.com/soberbw-hash/shanghao/actions/runs/36668311001)、[CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/36668310959)、[Release](https://github.com/soberbw-hash/shanghao/actions/runs/36668559116)与 [15 分钟耐久检查](https://github.com/soberbw-hash/shanghao/actions/runs/36668315439)均通过，对应上述发布提交。

## 官网与下载

- 先校验并上传 `downloads/v3.3.1`，再激活清单、构建并部署首页；首页根目录未使用危险的 `--safe` 回滚组合，未清理旧版下载。
- [官网](https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com/)的首页文件哈希与本次构建完全一致；在线 `release.json` 为 v3.3.1，链接、大小与哈希一致。
- 新安装包 HEAD 和镜像校验文件正常。CDN 对 Range 请求返回了完整文件，因此进一步校验了从官网实际下载的完整安装包 SHA-256 和字节数，均一致。
- v3.3.0 的旧安装包仍可访问且大小正确。官网发布摘要支持编号列表，避免把公告末尾的验证边界误当版本亮点。

## 仍需真实环境验收

- 已安装旧客户端发现更新、下载完成、用户点击安装并重启；未安装到真实用户环境，不以文件校验冒充完整升级验收。
- 五台真实设备、好友端手机麦克风听感、USB 热切换、屏幕 Viewer 与系统音频恢复、数小时挂机。
- 本次未部署 Relay/TURN 或账号服务器；源码中的可选收藏作者身份字段保持协议兼容，服务端同步需单独安排。
- 未删除、重置或覆盖真实聊天、账号、录音、Marker、模型、转录和用户设置。
