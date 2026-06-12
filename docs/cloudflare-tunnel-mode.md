# 临时公网模式

临时公网模式会先在房主电脑启动本地 SignalingServer，再启动 Cloudflare Quick Tunnel，把本地服务临时暴露为：

```text
wss://随机名称.trycloudflare.com
```

它不要求房主拥有公网 IP、端口映射或云服务器，好友也不需要安装 Tailscale。关闭房间时，`cloudflared` 子进程会停止，临时地址随即失效。

## 首次使用

首次选择临时公网开房时，上号会自动下载与系统匹配的 `cloudflared`。下载文件保存在应用用户数据目录的 `bin` 文件夹，不会写入项目目录。

如果下载或创建隧道失败：

1. 检查 Clash / Mihomo / TUN 是否阻断 GitHub 下载或 `trycloudflare.com`。
2. 暂停代理后重试。
3. 改用自部署云中继。

临时公网只负责让好友访问房主的信令服务。语音仍优先走 WebRTC；WebRTC 不通时，上号保留信令音频 fallback。
