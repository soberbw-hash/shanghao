# 自部署上号云中继

云中继适合长期使用。房主和好友都会主动连接同一台公网服务器，不要求房主电脑有公网 IP，也不需要路由器端口映射。

## 推荐服务器

- Ubuntu 22.04 LTS
- 2 核 2 GB 起步
- 3 Mbps 起步，5 Mbps 更稳
- 有公网 IPv4
- 安全组开放 TCP `43821`

## 首次部署

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable

sudo mkdir -p /opt/shanghao
sudo chown "$USER":"$USER" /opt/shanghao
git clone https://github.com/soberbw-hash/shanghao.git /opt/shanghao
cd /opt/shanghao
corepack pnpm install --frozen-lockfile
corepack pnpm relay:build
```

安装 systemd 服务：

```bash
sudo cp docs/shanghao-relay.service /etc/systemd/system/shanghao-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now shanghao-relay
sudo systemctl status shanghao-relay
```

验证：

```bash
curl http://127.0.0.1:43821/health
curl http://服务器公网IP:43821/health
journalctl -u shanghao-relay -f
```

看到 `"ok":true` 后，在上号设置页填写：

```text
ws://服务器公网IP:43821
```

点击“测试连接”，成功后选择“云中继”开房。

前期不需要域名、备案、HTTPS 或证书。长期公开使用时，建议再通过 Caddy/Nginx 配置域名与 `wss://`。

## 更新中继服务器

客户端和中继服务器最好使用同一个 GitHub Release / tag。只更新客户端、不更新服务器，可能导致加入确认、成员同步或协议版本不一致。

如果服务器部署在 `/root/shanghao` 并使用 PM2，执行：

```bash
cd /root/shanghao
git pull
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export FFMPEG_SKIP_DOWNLOAD=1
export FFPROBE_SKIP_DOWNLOAD=1
corepack pnpm install --filter @private-voice/shared... --filter @private-voice/signaling... --ignore-scripts
corepack pnpm --filter @private-voice/shared build
corepack pnpm --filter @private-voice/signaling build
pm2 restart shanghao-relay
curl -i http://127.0.0.1:43821/health
```

`/health` 应返回 `protocolVersion`、`buildNumber`、`packageVersion`、`activeRooms` 和 `connectedPeers`。若设置页提示服务器版本不同，请先将服务器更新到与客户端一致的 tag，再重试加入房间。
