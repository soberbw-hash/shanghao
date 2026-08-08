# 4 Mbps 网络验收

本页只用于测试环境，不会被上号客户端或生产服务器自动执行。限速会临时修改 Linux
默认网卡的根 qdisc，请在维护窗口中操作。

## 查看现状

```bash
sudo bash scripts/test-network-limit.sh status
```

## 受控测试

交互测试会把出口限制为 4 Mbps，并在按 Enter、收到退出信号或脚本正常结束时自动恢复：

```bash
sudo bash scripts/test-network-limit.sh run
```

也可以在限速期间执行指定命令：

```bash
sudo bash scripts/test-network-limit.sh run bash -lc 'corepack pnpm test:five-peer-audio'
```

测试期间记录：五人全部安静时备用语音流量、仅一位故障好友启用定向备用时的吞吐、
WebRTC 恢复后备用流量是否归零、`droppedRealtimeMessages` 是否持续增长，以及屏幕分享是否
主动降级而不是挤占语音。

## 强制恢复

如果终端或 SSH 会话异常中断，重新连接后立即执行：

```bash
sudo bash scripts/test-network-limit.sh restore
```

恢复后再次运行 `status`，确认不存在 `tbf rate 4Mbit`。脚本不会写入 systemd、网络配置或
生产启动流程。
