# 上号 ShangHao

给朋友一起开黑的 Windows 语音房。支持五人语音、屏幕分享、聊天、本地录音，以及 AI 转录、整理和房间问答。

[下载 Windows 版](https://github.com/soberbw-hash/shanghao/releases/latest) · [查看更新](https://github.com/soberbw-hash/shanghao/releases) · [问题反馈](https://github.com/soberbw-hash/shanghao/issues) · [官方网站](https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com/)

此仓库提供官方下载、使用说明和问题反馈，应用源码不公开。

## 下载与开始使用

支持 **Windows 10 / 11 x64**，当前正式版为 **v3.4.12**。

1. 打开[最新版下载页](https://github.com/soberbw-hash/shanghao/releases/latest)，选择 `Setup-x64.exe` 安装，或下载 `Windows-x64.zip`。
2. 使用手机号验证注册并登录账号。
3. 创建私人房间，或通过六位频道号找到朋友并加入。

下载页提供 `SHA256SUMS.txt` 校验文件。GitHub 自动生成的 `Source code` 归档仅包含此下载仓库的文档和演示图片，请使用上面的安装包或 Windows ZIP。

## 可以做什么

- **和朋友挂语音**：每间最多五人，支持降噪、按键说话、静音和成员独立音量。
- **一起看和聊**：屏幕分享、文字聊天、快捷语音、音效和音乐。
- **保存一整晚的声音**：录音保存在本机，支持收藏、标记和回听。
- **把语音变成文字**：选择云端或本地转录，整理录音内容；AI 问答和记忆按房间隔离。

## AI 使用提示

云端服务需要配置对应的 API 地址、模型和密钥；音频或文字会发送给你选择的服务商。本地模型按需下载，计算在本机进行。

当前正式版的纯文本云端转录使用估算时间位置，不提供说话人分离。需要精确逐句时间轴时，可选择支持时间轴的本地模型；说话人能力以具体模型和录音数据为准。

## 界面展示

以下为 v3.4.12 的隔离演示，不含私人录音或聊天。

![首页](docs/assets/releases/v3.4.12/release-home.png)
![AI 转录与整理设置](docs/assets/releases/v3.4.12/release-ai-settings.png)
![文本与转录模型配置](docs/assets/releases/v3.4.12/release-models.png)
![自定义 API 配置](docs/assets/releases/v3.4.12/release-models-custom.png)
![AI 提问](docs/assets/releases/v3.4.12/release-assistant.png)
![AI 回答](docs/assets/releases/v3.4.12/release-assistant-answer.png)
![提问历史](docs/assets/releases/v3.4.12/release-assistant-history.png)
![录音库与标记](docs/assets/releases/v3.4.12/recording-library.png)
![语音记忆](docs/assets/releases/v3.4.12/voice-memory-demo.png)

## 遇到问题

请到[问题反馈](https://github.com/soberbw-hash/shanghao/issues)说明软件版本、操作步骤和看到的错误。提交截图或诊断包前，请检查并去除私人聊天、录音内容、手机号及 API 密钥。

## 许可说明

后续自研代码采用专有许可，不公开源码。已公开版本的原有许可和既有授权保持有效，第三方组件、模型、字体和图片继续遵守各自许可证。
