# 在腾讯云部署 TURN

上号的文字、成员状态和低带宽语音兜底都走固定服务器。为了让不同省份、不同运营商、严格 NAT 下的好友也能优先获得低延迟 WebRTC 语音，建议在同一台 Ubuntu 服务器部署 coturn。

## 1. 开放腾讯云安全组

在腾讯云控制台的服务器安全组入站规则中开放：

- TCP `43821`：上号 WebSocket 服务
- UDP `3478`：TURN 首选传输
- TCP `3478`：UDP 不可用时的 TURN 备用传输
- UDP `49160-49220`：TURN 媒体端口池

来源可先设为 `0.0.0.0/0`。服务器只通过短期 HMAC 凭据允许 TURN 分配，不使用公开固定密码。

## 2. 一键安装

```bash
cd /opt/shanghao
git pull
sudo bash scripts/install-turn.sh
```

脚本会：

1. 安装并启用 coturn。
2. 自动识别公网 IPv4。
3. 生成随机共享密钥。
4. 写入 `/etc/turnserver.conf`。
5. 将 `TURN_URLS`、`TURN_SHARED_SECRET` 写入 `/opt/shanghao/.env`。
6. 重启 coturn 与 `shanghao-relay`。

如自动识别的公网 IP 不正确，可以显式传入：

```bash
sudo TURN_EXTERNAL_IP=118.25.103.107 bash scripts/install-turn.sh
```

## 3. 验证

```bash
sudo systemctl status coturn --no-pager
sudo systemctl status shanghao-relay --no-pager
curl -s http://127.0.0.1:43821/health
```

健康检查中应出现：

```json
{ "ok": true, "turnConfigured": true }
```

`turnConfigured` 只说明信令服务已经能下发临时 TURN 凭据。最终连通性还取决于腾讯云安全组和系统防火墙是否开放上述端口。

## 4. 日志排查

```bash
sudo journalctl -u coturn -n 100 --no-pager
sudo journalctl -u shanghao-relay -n 100 --no-pager
```

客户端设置页导出的诊断包会记录 `turnConfigured`、WebRTC 重建次数和兜底音频状态，但不会记录共享密钥。
