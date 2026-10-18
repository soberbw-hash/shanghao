# 上号 v3.4.10 发布核对

2026 年 10 月 19 日已完成 GitHub 与 CloudBase 发布。正式产品提交为 `1e85b7bc04b364a7aece9358c8e448b2c568072f`，标签为 `v3.4.10`；发布后只补充渠道清单与核对记录，不移动正式标签。

本机完整 smoke 1096 项，1095 通过、0 失败、1 项平台限制跳过；六个包类型检查、ESLint、生产构建与 203 项素材预览通过。五人音频覆盖 20 条定向路径、后加入、重连和 Relay；五人实际 WebRTC 媒体覆盖 20 条方向及恢复。独立界面回归覆盖普通与减少动态效果；新增卡片高度不变、历史滚动右边缘稳定、删除按钮与滚动条间距检查通过。

本轮回归覆盖收藏预览、普通与减少动态效果、三个状态原地切换、两种 API 表单、真实音量事件、暂停时标记自动收起、远端视频首次及替换后的转发。

实际编码器已将 3601 秒合成录音拆为 5 段，每段小于单次时长和大小限制；检查原文件完整及临时文件清理。没有上传用户录音。

公开网页预览实际返回标题、简介、网站来源和封面。已有 SenseVoice 完整请求及 GLM 问答验证见本轮桌面修复记录；本轮未将私人 API 密钥写入源码或发布资产。

## 正式产物与渠道

- [GitHub v3.4.10](https://github.com/soberbw-hash/shanghao/releases/tag/v3.4.10) 已公开安装包、ZIP、更新清单、差分映射、SHA256SUMS 与体积报告，并附四张隔离演示截图。
- [Windows 发布流水线](https://github.com/soberbw-hash/shanghao/actions/runs/39147080345)、[Windows / Linux CI](https://github.com/soberbw-hash/shanghao/actions/runs/39147072256) 与 [CodeQL](https://github.com/soberbw-hash/shanghao/actions/runs/39147072272) 全部成功。
- [CloudBase 官网](https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com) 首页、版本清单、安装包和校验文件均返回 HTTP 200；清单为 v3.4.10。保留的 v3.4.9 安装包仍返回 HTTP 200。
- 官网完整下载的安装包为 205238130 字节，SHA-256 与 GitHub 正式资产一致：`0416a059e6b2695812b328b12baf4015d8f3aa3cca47338046d3805ede975986`。
- GitHub 正式 ZIP 完整下载为 255585146 字节，SHA-256 为 `07ebe65cc5cd47848bc1a318b36f3a893846349bae7c9fdbda54bbab8eded5c4`；204 个条目 CRC 校验通过，包含程序与 app.asar，没有用户资料。
- 安装包体积约 195.73 MiB；打包资源核对包含原生辅助程序、字体、降噪和运行组件，未包含私人配置或 API 密钥。
- 本机正式版与开发版配置均已核对为文本 GLM、转录 SenseVoice 云端；开发版实际界面显示密钥已保存在本机，并已回到首页。

## 实机边界

尚未验证英雄联盟真实独占全屏、无边框与反作弊组合，也未完成三台不同电脑的跨网络通话验收。五人自动化与真实 WebRTC 测试不能替代这些现场结果。开发版已重新打开；正式版未自动安装，仍由用户主动触发升级。
