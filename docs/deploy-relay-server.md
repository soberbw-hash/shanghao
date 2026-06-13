# 自部署上号固定频道

固定频道适合 3–5 个好友长期使用。所有客户端连接同一台公网服务器，不要求任何一位好友拥有公网 IP，也不需要在玩家电脑上做端口映射。

## 推荐服务器

- Ubuntu 22.04 LTS 或更新版本
- 2 核 2 GB 起步
- 3 Mbps 起步，5 Mbps 更稳
- 公网 IPv4
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
cp .env.example .env
```

编辑 `/opt/shanghao/.env`：

```dotenv
CHANNEL_ACCESS_CODE=只告诉好友的频道码
PORT=43821
ROOM_NAME=ShangHao
```

频道码不会出现在健康检查和服务器日志中，`.env` 也已被 Git 忽略。

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

并填写相同频道码。长期使用建议通过 Caddy 或 Nginx 将连接升级为 `wss://voice.example.com`。

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

`/health` 会返回 `protocolVersion`、`buildNumber`、`packageVersion`、`activeRooms` 和 `connectedPeers`，但不会返回频道码。
