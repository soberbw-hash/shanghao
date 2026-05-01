# 腾讯云中继部署

如果房主直连和 Tailscale 都被网络环境拦住，可以把腾讯云服务器当作“上号云中继”。

## 服务器要求

- Node.js 20 或更新版本
- 开放 TCP 端口 `43821`
- 安全组允许好友访问该端口

## 启动

```bash
git clone https://github.com/soberbw-hash/shanghao.git
cd shanghao
corepack enable
corepack pnpm install
PORT=43821 corepack pnpm relay
```

## 验证端口

在服务器上执行：

```bash
curl http://127.0.0.1:43821/health
```

在你自己的电脑上执行：

```bash
curl http://你的服务器公网IP:43821/health
```

能看到 `ok: true` 才说明安全组、防火墙和服务都通了。

启动成功后，在上号桌面端设置里把云中继地址填成：

```text
ws://你的服务器公网IP:43821
```

如果你后面配了域名和 HTTPS 反代，可以使用：

```text
wss://你的域名
```

## 使用方式

1. 房主在首页选择“云中继”。
2. 开启房间。
3. 把生成的房间地址发给朋友。
4. 朋友粘贴地址加入。

如果“房主直连”或 “Tailscale” 加入失败，优先切到云中继。云中继的逻辑是双方都主动连接腾讯云服务器，不要求房主电脑暴露端口，所以最适合复杂家宽、校园网、公司网、代理/TUN 环境。

云中继只负责转发房间信令和必要的兜底音频，不做账号、数据库和公开社交。
