# 自部署上号固定频道

固定频道适合 3–5 个好友长期使用。所有客户端连接同一台公网服务器，不要求任何一位好友拥有公网 IP，也不需要在玩家电脑上做端口映射。

## 推荐服务器

- Ubuntu 22.04 LTS 或更新版本
- 2 核 2 GB 起步
- 3 Mbps 起步，5 Mbps 更稳
- 公网 IPv4
- 安全组开放 TCP `43821`
- 推荐同时开放 TURN：TCP/UDP `3478` 与 UDP `49160-49220`

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
cp .env.example .env
```

编辑 `/opt/shanghao/.env`：

```dotenv
PORT=43821
ROOM_NAME=ShangHao
TURN_URLS=turn:服务器公网IP:3478?transport=udp,turn:服务器公网IP:3478?transport=tcp
TURN_SHARED_SECRET=由安装脚本生成的随机密钥
TURN_CREDENTIAL_TTL_SECONDS=86400
```

`.env` 已被 Git 忽略。`TURN_SHARED_SECRET` 只保存在服务器上，健康检查与日志不会返回它。

跨地区、跨运营商语音建议继续执行 [TURN 部署步骤](./deploy-turn.md)。只启动信令服务也能使用低带宽语音兜底，但 TURN 能让媒体链路延迟更低、多人时更稳定。

安装 systemd 服务：

```bash
sudo cp docs/shanghao-relay.service /etc/systemd/system/shanghao-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now shanghao-relay
sudo systemctl status shanghao-relay
```

## 验证

```bash
curl http://127.0.0.1:43821/health
curl http://服务器公网IP:43821/health
journalctl -u shanghao-relay -f
```

看到 `"ok":true` 后，在每位好友的上号设置页填写：

```text
ws://服务器公网IP:43821
```

长期使用建议通过 Caddy 或 Nginx 将连接升级为 `wss://voice.example.com`。

## 更新服务器

客户端和服务器必须使用同一个 GitHub Release/tag。协议版本不同会被明确拒绝，避免出现“看似在线但没有声音”。

```bash
cd /opt/shanghao
git pull
corepack pnpm install --frozen-lockfile
corepack pnpm relay:build
sudo systemctl restart shanghao-relay
curl -i http://127.0.0.1:43821/health
```

`/health` 会返回 `protocolVersion`、`buildNumber`、`packageVersion`、`activeRooms`、`connectedPeers`、`turnConfigured` 与实时丢帧计数，但不会返回 TURN 密钥。
