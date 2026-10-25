# 临时房间公网 / LAN 同一 Session 实现与证据

2026-10-23。只在当前 dirty 工作区续作，保留全部原有文件和用户数据。本领域没有发布、部署、打包、修改版本号或联系审核窗口。下面的“进程”均为测试创建并拥有的 Node 子进程；没有终止用户应用、广播真实 LAN 公告或操作真实系统输入。

## 结果与入口

临时创建统一由本机 Main 启动的唯一 `SignalingServer` / `TemporaryRoomCoordinator` 承担。LAN 直接通过设备签名公告中的 TLS pin 连接它；互联网成员通过既有公网服务器的反向 WSS 字节管道，在管道内建立精确 pin 的 TLS/WebSocket。两条路径进入同一个协调者和 `RoomManager`，保留 Session/memberId；没有另建一份公网房间或替换录音、音频与 Peer 路径。

生产 Main 的既有 `temporary-rooms-ipc.ts` 构造 host/router/client，路由器把已有信令地址作为 broker 地址。公网服务新版本通过 `/temporary-bridge` 接收认证控制及配对请求；旧服务不支持时，创建和 LAN 使用仍可进行，Main descriptor / 连接事件明确保留 `temporary_internet_bridge_unavailable`，由已接入的 UI 显示“仅局域网可用”。没有自动部署服务端。

## 模块与接口

| 模块                                                         | 职责与主要入口                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/signaling/src/temporary-internet-protocol.ts`      | 固定域的设备注册签名、公开成员公钥表、TLS pin；`verifyInternetRegistration`、`verifyInternetHandoffChain` 验证每个缺失 epoch 的多数选票及状态批准。白名单归一化剥除未签名扩展字段。                           |
| `temporary-internet-directory.ts`                            | `register`、`closeSession`、`hasCode`、`flush`；串行原子文件提交公开 owner/epoch/revision 高水位与终止记录，冲突码不可覆盖。损坏/未知版本文件保留并拒绝写入。                                                 |
| `temporary-internet-broker.ts`                               | `attach`、`owns`、`sweep`、`flush`；fresh challenge/PoP、精确查码、authority/member provider 注册、成员单独 withdraw、最后关闭 terminal；一次性短期管道 secret 配对及有界二进制转发。                         |
| `temporary-room-runtime.ts` / `temporary-runtime-options.ts` | 为既有 server 接窄入口；Main 临时服务不继承永久房间存储或公网 broker 权限；公网索引与原临时协调者共同占用全局码。                                                                                             |
| `apps/desktop/src/main/temporary-internet-connection.ts`     | Main-only 配对与 TLS pin 检查；内层 socket 交给原 Main 信令桥；控制请求按 socket 代际拥有，取消释放管道，包装流消费迟到错误，大 TLS 写入拆成有界外层帧。                                                      |
| `temporary-internet-provider.ts`                             | provider 仅能转发到该代际自己启动的固定 `127.0.0.1:port` TLS 服务；没有 renderer 目标地址或通用 TCP 代理。公网 TURN 配置沿用服务器现有生成入口。                                                              |
| `temporary-host-internet.ts`                                 | 公网签名注册、TTL 刷新、受控失败退避、失效代际保护；authority 终止与 member withdraw 分离。                                                                                                                   |
| `temporary-internet-lineage.ts`                              | 将私密复制状态提取为公开成员表、证书 pin 和不透明状态头，生成逐 epoch 移交链；不会把 checkpoint/ticket/tokenHash 复制到 broker 请求中。                                                                       |
| `temporary-lan-host.ts` / `temporary-room-router.ts`         | 本地 TLS 服务生命周期、公网发布、全局码冲突后原 Session 换码、LAN/公网同码冲突拒绝、LAN / 公网路径选择与同 Session 恢复。                                                                                     |
| `temporary-lan-replication.ts`                               | 私密 checkpoint 的加密 WSS 复制、前一成员视图严格多数提交、成员移除 fence、租约与选举、移交安装和新 proof 恢复。私密 RPC 也能走内层 TLS 公网管道。                                                            |
| `temporary-room-client.ts`                                   | Main 保存票据和异步 socket 归属；Renderer 只收到不透明 context。恢复绑定原 Session/memberId 与新 epoch；首个 warning 随 descriptor 返回，普通 connected 更新保留 warning，仅匹配 Session 的明确公网恢复清除。 |

原 `server.ts` 只增加窄 temporary runtime 接线；当前文件仍在既有 1835 行护栏内，没有提高预算。

## 安全及生命周期约束

- 八位码用于发现和请求加入，不能管理房间、注册 authority 或重放成员恢复。设备 challenge 单次、短时、绑定公钥/audience/Session；管理员操作仍检查角色、epoch/revision。
- UDP 只携带设备签名的 Session/authority/epoch/端口/短期发现标识和证书 SHA256 pin，不携带码、可复用票据或私密复制状态。认证后的查码通过精确 pin 的 WSS。
- 公网 broker 只看公开注册与外层字节，不解析内层 proof、票据、聊天、音频、私密 checkpoint；管道 ID/secret 在 WSS 消息体传递，未放入 URL、Renderer、UDP 或日志。
- 控制帧 256KiB、加密外层帧 64KiB、每管道缓冲 1MiB / 8MiB 每秒，单 Session 24 管道、单消费者身份 8、全局 256；配对 10 秒期限且 secret 一次性。Main 将 TLS 批次分成 16KiB 外层帧，单批写入上限 2MiB。
- 公网索引最多 4096 条、单 authority 最多 16 个活动 Session；公开高水位/终止记录有界保留 24 小时。仅 TTL 刷新不每五秒改写文件。生产服务需为既有私人房间目录配置持久路径；派生的 `.temporary-internet.json` 归同一服务器进程拥有，没有路径时仅内存，重启后对未知高 epoch 安全拒绝。
- 私密复制保留锁定、码、撤销记录、票据 hash/代际、heartbeat、30 秒 grace/reproof deadline、关闭 tombstone，不能用 public snapshot 代替。新 epoch 旧票据作废，需新 Session-bound proof / ticket，既有 grace deadline 不延长。
- 新主持在成员刷新公告前保留旧视图中已认证的端点；端点签名仅提供连接信任，不让旧 epoch 票据复活。这修复了第一名成员恢复后，第二名成员立即重连因端点过早丢弃而缺 quorum 的竞态。
- 当前 writer 仅在已确认的严格多数租约内写入；1/3 不可续租、接管或创建替代 Session。权威时钟倒退超出 200ms 后永久 fence 当前协调者，不能靠回拨延长 lease。选举仍以显式 200ms 最大时钟偏差为前提，重启有隔离等待。
- 公网断网期间的历史证书只能更新目录 epoch 顺序，不能授予活动 writer lease 或代替 fresh import/proof。最多保留最近 24 次移交，超出目录锚点可验证范围时拒绝公网续接，LAN 服务继续；没有绕过多数或凭更大的 epoch 整数接管。

## 真实验证

最终从 `apps/desktop` 运行：

```powershell
node --import tsx --test --test-concurrency=4 tests/temporary*.test.ts
```

结果 **73/73 通过，0 失败，0 跳过**，约 80.7 秒。随后只新增一项生产身份存储专用签名器检查，identity 文件重跑 **5/5**，当前共 74 个不同的已通过临时领域用例，没有再重复跑整组。另跑永久房间目录/信令/Main client 与架构护栏 **20/20**。包含以下实际隔离网络/进程行为：

- `temporary-internet-tunnel.test.ts`：真实 HTTPS broker、Main 临时 TLS 服务、真实一次性外层 WSS 配对、内层精确 pin TLS；LAN 和公网成员同 Session 的 `join_ack`、聊天/ACK、`peer_offer`。230KiB 与 1300KiB 内层帧经有界外层帧往返字节一致。
- `temporary-internet-security.test.ts`：真实 loopback UDP + WSS 的同码不同 Session 拒绝；全局码冲突后只换码、保留原 Session/成员票据；过期/伪造注册、无关成员 provider、缺少移交证明、错误/重放 secret 拒绝。错误 TLS pin 不能进入房间；取消未完成 TLS 及时关闭 owned TCP；旧 socket 的迟到 close 不拒绝新代际 RPC；成员 withdraw 不终止房间。
- `temporary-internet-directory.test.ts` / `temporary-internet-handoff.test.ts`：原子竞争只有一个码 owner，目录重启、损坏文件保护、terminal 防旧注册；断网期间成员表变化与连续两个缺失 epoch 逐轮验签，缺失或不足多数证书失败，旧 epoch 不可覆盖；公开 payload 剥除未签名扩展中的模拟秘密字段。
- `temporary-lan-process-recovery.test.ts` **6/6**：三个独立 Main 主持进程真实崩溃、旧主持分区写租约失效、1/3 少数拒绝；私密复制/选票/批准强制经公网内层 TLS 的真实崩溃恢复；持久化 broker 重启后多数进入 epoch 2，原 Session/code 可再次加入；五个独立进程在 broker 中断期间连续两次实际主持崩溃，剩余 3/5 迁移到 epoch 3，再连接 broker 验证两轮历史后原 Session/code 可查。
- 既有 identity/auth/coordinator/replica/discovery/election/LAN integration/signaling/client 回归同时通过。锁定、换码、踢人撤销、精确 grace、旧票据/旧 proof、防回滚与最后离房关闭均保留；新增 clock rollback fence 与 warning 语义通过。1024 个实际随机临时证书通过 DER serial 正数/最小编码回归。
- 生产 `TemporaryIdentityStore` 的专用公告、目录注册、状态头签名使用隔离加密文件中的同一个持久设备 key；真实验签成功，异设备/过期字段拒绝。私钥不出 Main，也没有新增万能签名 IPC。

最终 desktop / signaling `tsc --project tsconfig.json --noEmit`、全部 `temporary*.ts` 实现/测试的 scoped ESLint 及格式检查通过。主任务负责最终整轮 smoke、媒体回归、构建及统一审核，本领域未重复跑整轮 smoke。

## 仍需如实保留的边界

没有两台真实电脑、真实 LAN 广播、异网 NAT/TURN、真实耳机/应用音频或长时间耐久验收；本机隔离进程证据不能替代。公网服务未部署，新旧服务的生产兼容仅有本地协议拒绝与 LAN 降级逻辑。现有 WebRTC 媒体、录音 Track 和远程协助授权未另建实现；最终整合媒体检查由主任务统一运行。目录/移交数量及最大时钟偏差是上述明确的有界策略，不能宣称无限次移交或任意错误时钟下持续服务。
