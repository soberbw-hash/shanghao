# 部署上号固定频道

上号客户端只连接这一台固定服务器，不再包含房主直连或 Tailscale。正式使用推荐 `wss://`，裸公网 `ws://` 只用于短时间排障。

## 准备

- Ubuntu 22.04/24.04 公网服务器
- 2 核 2 GB 起步
- 一个已解析到服务器公网 IP 的域名，例如 `voice.example.com`
- 腾讯云安全组开放 TCP `80`、`443`
- 使用 TURN 时额外开放 TCP/UDP `3478` 与 UDP `49160-49220`

## 一键安装 Relay + WSS

```bash
sudo SHANGHAO_DOMAIN=voice.example.com bash scripts/deploy-relay-ubuntu.sh
```

脚本会检查 Ubuntu 和 Node 22、启用 Corepack、创建不可登录的 `shanghao` 系统用户、安装依赖、构建 Relay、写入强化的 systemd 服务、配置 Caddy、启动服务并执行 `/health` 检查。

应用目录为 `/opt/shanghao`，聊天数据位于 `/opt/shanghao/data`。首次安装会生成 `/opt/shanghao/.env` 和 64 位十六进制 Relay Token；再次运行绝不会覆盖已有 `.env`。

把服务器上的 Token 组合进客户端地址：

```text
wss://voice.example.com/?token=你的RELAY_ACCESS_TOKEN
```

客户端首页只显示域名和端口，诊断包与日志会清理查询参数，不会记录 Token。

## 没有域名时临时测试

```bash
sudo bash scripts/deploy-relay-ubuntu.sh
```

临时开放 TCP `43821`，客户端填写：

```text
ws://服务器公网IP:43821/?token=你的RELAY_ACCESS_TOKEN
```

公网 `ws://` 没有 TLS，只应用于测试。长期使用请配置域名后重新执行带 `SHANGHAO_DOMAIN` 的命令。

## Caddy 反向代理

一键脚本会生成同等配置，手工部署时可使用 [`deploy/Caddyfile.example`](../deploy/Caddyfile.example)：

```caddyfile
voice.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:43821
}
```

WebSocket Upgrade 由 Caddy 自动处理，证书也会自动申请和续期。

## 验证和维护

```bash
curl -fsS http://127.0.0.1:43821/health
sudo systemctl status shanghao-relay --no-pager
sudo journalctl -u shanghao-relay -f
sudo systemctl restart shanghao-relay
```

`/health` 会显示最终 `maxRoomMembers`、协议、构建、在线人数、TURN 配置和丢帧计数，不会返回 Token 或 TURN 密钥。

## 安装 TURN

不同省份、运营商或严格 NAT 下，建议继续执行 [TURN 部署](./deploy-turn.md)：

```bash
cd /opt/shanghao
sudo bash scripts/install-turn.sh
```

Relay 只下发有时效的临时 TURN 凭据，共享密钥始终留在服务器。
