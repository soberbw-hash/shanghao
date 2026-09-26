# 手机麦克风 sidecar 运维

手机麦克风 Web 配对服务与主信令 Relay 分开运行。公网 HTTPS `/phone-mic` 由既有反向代理转发到本机 `127.0.0.1:43822`；主 Relay 仍监听 `43821`。服务端账号 `shanghao-phone-mic` 不可登录，不读取主 Relay 的完整环境文件。

## 构建与部署

在本地运行 `corepack pnpm test:phone-mic`，它会生成独立的 `packages/signaling/phone-mic-sidecar-dist/phone-mic-sidecar.cjs` 并验证启动和健康接口。先确认服务器主 Relay 健康，再将 bundle、`deploy/install-phone-mic-sidecar.sh` 与 `deploy/systemd/shanghao-phone-mic.service` 传至服务器暂存目录。检查 bundle 后，以 root 执行：

```bash
bash -n /path/to/install-phone-mic-sidecar.sh
node --check /path/to/phone-mic-sidecar.cjs
sudo bash /path/to/install-phone-mic-sidecar.sh /path/to/phone-mic-sidecar.cjs 3.2.0
```

安装器从既有 `/root/shanghao/.env` 只提取 TURN 所需字段，生成 `/etc/shanghao/phone-mic.env`（`root:shanghao-phone-mic`，`0640`）。不要把主 Relay 的完整环境文件或账号凭据复制给 sidecar，也不要将这些文件提交到仓库。服务、bundle、env 的旧文件会在覆盖前保留带 UTC 时间戳的备份；健康检查失败时自动恢复。需要人工回滚时，先核对备份时间戳和内容所属版本，再恢复三个文件，执行 `systemctl daemon-reload` 与 `systemctl restart shanghao-phone-mic`。

## 发布后检查

```bash
systemctl show shanghao-phone-mic -p ActiveState -p User
curl --fail http://127.0.0.1:43822/phone-mic/health
```

健康响应只包含 `status`、`version`、`buildNumber`、`activeSessions`、`uptimeSeconds`、`relayReady`，不包含会话身份、音频或聊天内容。`relayReady=false` 表示主 Relay 无法从本机健康接口访问，不能仅凭 sidecar 进程存活判定手机配对可用。公网还应分别确认 HTTPS 页面可访问、未登录的 `/phone-mic/ticket` 请求被拒绝，以及真实登录账号用手机扫码后能够产生可听的音频；前两项不能代替最后一项。
