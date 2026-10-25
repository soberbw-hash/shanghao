# 临时联机与远程协助：实际代码审计与实施边界

日期：2026-10-22。性质：独立只读架构审计；除本文档外不提交实现修改。依据用户 V1.0 完整需求、根 AGENTS.md、仓库 AGENTS.md、development-playbook.md、当前工作树和定向隔离测试。本文不是功能完成声明。

## 1. 基线与已经验证的证据

- 仓库：`work/shanghao`；HEAD `69ec086`；当前本地 package 版本 `3.4.13`，不能以公开 `3.4.12` 覆盖。审计开始时 86 个 tracked 文件修改，另有大量未跟踪 AI、录音、设置和说明文件；staged 为空。
- 交叉修改点已读：Main `index.ts`/`ipc.ts`、settings migration、recording library/participant tracks、RoomDock/PrivateRoomBrowser、shared AI/settings types 和 Cargo manifests。保留这些已有修改，新增功能接线不能覆盖其自动转录、模型使用锁、静音回收、麦克风状态及私人房间入口修复。
- 工具链为 Electron 42 / React 19 / TypeScript / Vite / Zustand / ws / WebRTC + Rust sidecar；仓库要求 pnpm 10.34.5。当前 shell 无 `corepack`；`pnpm` fallback 实际为 11.25.0。
- 本次执行 9 个现有测试文件，共 **62/62 通过**：`private-room-directory`、`private-room-signaling`、`signaling-security-history`、`signaling-room-sync`、`signaling-bridge-lifecycle`、`signaling-client-race`、`screen-share-coordinator-races`、`screen-share-manager-lifecycle`、`rust-core-host`。测试命令为 `pnpm --dir apps/desktop exec tsx --test tests/<上述名称>.test.ts`；测试报告 duration 1717.7987ms。该 pnpm 命令隐式安装并将 lockfile 的 autoInstallPeers 改为 true，已用 apply_patch 精确恢复该单行，最终 lockfile 无 diff。后续用匹配版本或已安装的 `node --import tsx --test`，避免隐式安装。
- 这些测试证明当前私人房间、20 秒重连、消息 ACK/去重、五席、按 Peer 分享故障恢复及 Rust host 并发回复有回归基础；没有证明临时房间、LAN、真实 P2P 路由或远控已经存在。
- 未执行真实系统输入、服务器部署、发布、源码可见性变更、安装器构建或用户数据清理。

## 2. 能力清单：可扩展处与实际缺口

| 能力           | 当前真实实现与定位                                                                                                                                    | 本次必需增量                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 正式账号       | `main/account-service.ts`、`account-session-store.ts`；CloudBase/Supabase token 验证；账户 Session OS 加密                                            | 保持账号准入；独立临时身份不能借游客访问永久目录                                                                   |
| 本地资料       | settings 有 profileId、昵称和头像；AccountSessionStore 使用 async safeStorage + atomic-private-file                                                   | 独立版本化游客档案、设备密钥；私钥仅 Main；读损坏时不覆盖；不能把 settings.profileId 当已认证主体                  |
| 首页           | `renderer/src/app/App.tsx:282` 对 signed_out / verification_required / unavailable 返回 AccountPage；AccountPage:815 仅服务端 guestAllowed 才显示游客 | 临时入口必须绕过账号 gate 和账号服务联网等待，正式频道仍需登录；临时入口不是 continueAsGuest 开关                  |
| 房间身份       | `shared/types/private-room.types.ts:33-37` 接受 room_ UUID，isStoredRoomId 仅 main/side/永久 ID                                                       | 增加 temporary RoomScope / Session ID；8 位码只查找，不能成为存储/权限主键                                         |
| 准入与权限     | `signaling/server.ts:422-480` 按 account bearer 或开发 guest 验证 socket；:887 在 production 一律 assertCanJoin 永久目录                              | 独立、显式 temporary credential 准入分支，不能全局打开 guestAllowed 或弱化永久校验                                 |
| 游客安全       | `server.ts:863` 从自报 profileId/peerId 构造 guest 身份；:921-943 用同 profile 替换旧会话                                                             | 新游客必须 device-key PoP；否则别人报同 ID 会踢掉原成员。该旧路径只适合现有开发兼容                                |
| 五人和恢复     | RoomManager、PeerManager、SessionTokenStore 已有 5 席、主动离开删除最后 runtime、断线保留/令牌轮转；token 存 hash                                     | 新临时权威目录、房间码映射、锁/踢/轮换、管理迁移、集中约 30s grace；不能照用永久“新成员占位可驱逐 grace”策略       |
| Mesh           | `webrtc/src/createPeer.ts`；RoomClient:createPeer；每 Peer ICE、Track、恢复与统计                                                                     | 同一 Mesh 复用；新增固定 DataChannel、身份绑定、统一信令路由；禁止复制音频链                                       |
| 公网兜底       | TURN secret 派生凭证、可选静态 TURN、按 Peer PCM/audio 和 WebP screen signaling relay                                                                 | 临时 ticket 绑定与额度、短期 TURN，凭证刷新；静态永久 TURN 不用于新游客默认路径；统计实际路径和流量                |
| 屏幕分享       | ScreenCaptureService 枚举 screen/window/displayId；ScreenShareManager 唯一拥有 capture tracks；RoomScreenShareCoordinator 拥有发布/relay              | Main 可信 capture handle + shareSessionId + source/display geometry/generation；现有 bool isSharing 不足以授予输入 |
| 离线 LAN       | 当前源码未有 dgram/mDNS 临时房间发现/协调者任期/移交实现                                                                                              | Main 局域网发现、本地 WSS 协调 endpoint、经过认证的入房与成员复制/移交/选举                                        |
| 系统输入       | Rust Core 只有 6 类 capabilities/activity/file/process 命令；PhoneInput.cs 是只读键位观察；uiohook 目前用于快捷键                                     | Rust 支持的 Win32 SendInput、固定事件白名单、会话 lease/watchdog、按键释放；macOS 明确只读/权限降级                |
| 独立观看窗     | ScreenShareViewerPage 是本机第二条 RTCPeerConnection；Main 用 sender WebContents + viewer session 验证 IPC                                            | viewer 只将用户操作回送房间宿主；房间宿主经网络 Mesh 转发；viewer sessionId 不是远端 share/control ID              |
| 聊天/收藏/日报 | server join 无条件读历史/收藏/recordJoin；acceptChatMessage:1283-1320 无条件 append 持久 ChatHistoryStore/日报                                        | temporary policy 进入专用内存历史和会话收藏；禁止落永久房间记录；按生命周期清理                                    |
| 录音/AI        | 原生录音/个人库/自动转录齐全；roomId 归属保存在本地；automatic backlog 为当前已有改动                                                                 | 本地允许临时 origin；禁止用同一 isStoredRoomId 同时放开云端上传；自动上传需 room scope + 临时单独授权              |

## 3. 最小模块边界与接口

以下是新增候选文件和接线点；不要求把现有大文件拆开重写。先补纯状态机，再将既有入口接到策略上。

### 3.1 共享协议与本地身份

新增 `packages/shared/src/types/temporary-room.types.ts`、`remote-control.types.ts`、`room-session.types.ts` 并由 shared index 导出。

```ts
type RoomScope = { kind: "permanent"; roomId: string } | { kind: "temporary"; sessionId: string };
type RoomSessionBinding = {
  scope: RoomScope;
  memberSessionId: string;
  memberGeneration: number;
  authority: { kind: "server" | "lan"; id: string; epoch: number };
  revision: number;
};
```

统一保留 `peerId` 作为现有 Mesh key；设备主体、正式 account userId、临时 memberSessionId、IPC owner session、shareSessionId 和 control grantId 分别命名。禁止把短房间码或 account 身份字段重用为控制授权。

新增 Main `temporary-identity-store.ts` 和 `temporary-rooms-ipc.ts`：

- `getProfile(): PublicLocalProfile`、`saveProfile(input): PublicLocalProfile`、`signChallenge(challenge): SignedProof`。私钥不返回 renderer；签名输入必须是固定 domain + version + bounded typed transcript，不提供任意 bytes 签名。
- 使用 Node crypto 安全生成设备 Ed25519 key、随机 ID，复用 safeStorage 与 writePrivateFileAtomically。公用资料和加密私钥分别保存，版本迁移遵循损坏保护规则；safeStorage 不可用时明确报错，禁止明文 fallback。
- 已登录者使用 Main 已有账号快照的 displayName/avatar，仍可使用设备 PoP；临时 join 不依赖账号 refresh 成功，不改变账号存储。正式账号 id 仅通过后端 bearer 验证后才可信。
- 昵称延续既有 protocol `isValidNickname` 的 16 字符约束，或同时版本化改到 20；不能 UI 接受 20 而 join validator 拒绝。上传复用主进程现有头像解码/尺寸限制；头像留本地，不调用 account avatar 上传接口。
- preload/index.ts、shared ipc.types.ts / constants/ipc.ts、renderer/core/shanghaoCore.ts 新增显式 temporaryRooms API；不开放 generic invoke。

### 3.2 临时会话权威与服务端准入

新增 `packages/signaling/src/temporary-room-manager.ts`（纯状态机）、`temporary-room-http-controller.ts`（解码、限流、挑战和路由）；server.ts 仅接线。

建议 manager 接口：`create(principal) / resolveCode(code) / join(sessionId, principal) / resume(binding, token) / disconnect(binding) / leave(binding) / kick(actor,target) / setLocked(actor,bool) / rotateCode(actor) / sweep(now)`。所有 actor 从已验证 socket/ticket 得出，不接收客户端自报管理员。

- 内部 ID 例如 `temp_<32 hex>`，代码 `randomInt(0, 100000000).toString().padStart(8,"0")`，原子 reserve + 有界碰撞重试；code map 指向 Session ID。code rotation、踢人、销毁时原子撤销对应旧凭证。
- ticket 包含 aud/version/sessionId/memberSessionId/device key fingerprint/memberGeneration/expiry/jti；短期入房票与可轮转 resume token 分开。Main 通过 HTTPS create/join 后在临时 WSS 验证 PoP；server 覆写 room/peer identity 继续沿用现有 anti-spoof 模式。
- 同一设备多实例按已证明设备身份实施显式 replace 或 reject，不能用未证明 profileId 替换。
- create/resolve/join 在服务端按 IP + 设备证明双限流；失败递增冷却、全局创建上限、TTL、有界 map、无批量列房间 API。未加入不返回成员表或音视频凭证。
- `server.authorizeSocket` / `handleJoin` 用显式临时 credential 路径分流，永久 room_ 仍按账号目录；不要用 `NODE_ENV!==production` 当临时授权。
- 管理员按稳定加入顺序迁移；媒体不因管理员迁移重建。主动 last leave 立即清 room/code/tickets/history；disconnect 约 30 秒保留席位和身份，所有成员离线后 grace 到期销毁。临时模块注入 now/timers，便于精确边界测试。
- 同进程目录唯一；现有部署是否多实例必须核实。若多实例，code reservation、join 5 席和 ticket revocation 需要共享原子存储或单一权威路由；纯 Map 不能宣称跨实例正确。
- 旧客户端未声明 temporary/remote-control capability 时不向其推新协议；永久 protocol 7 保持，新增字段可选并提供明确 unsupported，不能一刀切全局升级版本导致老永久客户端下线。

### 3.3 LAN 与公网复用同一会话

新增 Main `lan-room-discovery.ts`（dgram socket、限流/大小/TTL、网卡变化）、`lan-room-coordinator.ts`（本地 endpoint 和权威服务适配），可共享上述纯 manager，不启动整个包含账号/持久日报/云 AI 的 SignalingServer。

- discovery 只广播协议版本、Session ID、代码匹配摘要/查询结果、endpoint、公钥指纹、epoch、短 TTL；不广播入房/resume/control token。接入用户仍须代码与独立随机 session secret / device PoP，不能信任来自同 Wi-Fi 的身份。
- 局域网也用认证与加密。不能 `ws://` 明文发送 bearer，再用“在 LAN”作为安全证明；不能把 discovery 自报指纹当已认证身份。第一接触需定义完整握手（例如经过审计的 PAKE 证明代码持有、绑定临时 TLS/协调者公钥，再签发随机成员凭证）；代码不是直接加密 key。不要临时自创密码协议。
- 两个来源返回同码不同 Session ID 时向用户显示歧义，不静默取第一条。在线登记以 Session ID + authority proof 保持现有会话，发生全球 code collision 只换 code 并同步成员，不换 Session ID/peer/track。
- graceful handover：旧协调者提交最新成员集、锁状态、代码、epoch 与前序状态 hash，指定 successor 确认可用、启动发现后再退出；管理权与协调权分别处理。
- crash handover：用已认证成员通道传递最新 committed membership、epoch、revision 和投票；按确定顺序竞选，只有获得合法多数的更高 epoch 才受理新入房；拒绝旧 epoch。没有 quorum 或网络分区时保持现有可用媒体、明确“暂时无法接纳新成员”，不宣称房间完全恢复。
- 两成员房间剩一个节点与分区不可区分；必须明确采用的失败语义，不能同时承诺任意分区无双主和单节点永远自动恢复。至少为需求要求的三人及以上协调者故障提供自动恢复证据；极端条件按需求可明确降级。
- 网络协调切换只替换 signaling adapter，保留已有 `RoomClient.peers`；不能重走 joinChannel 的 cleanupPreviousSession，否则会切断全部音视频。

### 3.4 RoomClient 与 Peer transport

`RoomClient` 目前内部 new SignalingBridge，重连 URL 固定；Main SignalingClientBridge:connect 总会读取 account token。因此先向 RoomClient 注入显式 `RoomSignalingTransport`（connect/send/close/onEvent + authority epoch）及 `RoomSessionBinding`，默认仍用原 SignalingBridge。Main 负责 endpoint/凭证选择，不让 renderer 随意携带账号 bearer 到 LAN 地址。

接线位置：`features/room/roomClient.ts:79,139,499,843`、`SignalingBridge.ts`、Main `signaling-client.ts`、`useRoomState.ts:533,940`。

- `useRoomState.joinChannel` 现先 `isStoredRoomId`，再 rooms.get、history restore、rememberJoined、日报；拆成“解析/准入 descriptor”和共享“启动现有房间 runtime”两步，永久保留现状，临时传入 descriptor + policy。
- snapshot 顺序从单一 revision 改成经过身份验证的 `(authorityEpoch, revision)`。允许协调者转换后的新序列，拒绝旧权威迟到消息；不要每次 authority 变更 clearPeers。
- `webrtc/src/createPeer.ts` 尚无 DataChannel。首个 offer 前由确定一方创建固定 label（双端按 peerId 排序决定），另一方 ondatachannel 校验 label/version。所有节点同意签名的 member key 和 SDP/DTLS fingerprint 绑定，不能仅看 payload.senderPeerId。
- 一个可靠、有序通道处理 request/approve/reject/revoke/key/button/release-all；另一个 maxRetransmits=0 的通道处理可合并 pointer move。必须有双方 capability negotiation 和冲突处理，不能双方无序创建重复 label。
- 控制输入优先走同一个 Mesh Peer；TURN 时同一 DataChannel 自动过 TURN。若需要 signaling relay 控制兜底，必须签名/加密、同等授权校验和 bounded queue；不能因为只有截图 fallback 就假定 WebRTC 数据可用。路径不可用则明确暂停控制，不能显示 granted 仍丢所有输入。
- 观测 selected candidate local/remote type、RTT/丢包现有 stats 可复用；补 LAN vs internet、TURN vs 应用 relay、bytes、重试/恢复时间、control latency。不要仅用 connectionState=connected 宣称直连。

### 3.5 屏幕分享授权与原生执行

新增 Main `remote-control-service.ts`（唯一 grant 权威）与 `remote-control-ipc.ts`（sender/shape 校验）；renderer 新增 `RemoteControlCoordinator.ts`（传输和 UI 状态）与纯 `remoteControlCoordinates.ts`。Rust 新增 `remote_input.rs`（平台执行）和独立 input worker 生命周期，复用 RustCoreClient host 基础但不复用可阻塞的命令队列执行安全撤销。

Main 提供固定 API：`request(peer,share) / respond(requestId,allow,duration) / pause(grantId) / resume(grantId) / revoke(grantId) / acceptInput(envelope) / onState(listener)`；只有本机可信主窗口可以 respond。远端或 viewer 发来的 approve 不能生成本机 grant。

- `screen-capture-service.ts` 增加 Main 生成的 capture handle，绑定实际已选择 source、screen kind、displayId、screen bounds/scaleFactor/virtual desktop、geometryVersion 和 shareSessionId；`window.ts:461` 成功批准采集后记录，不从 renderer 自报 kind 决定。现有 exact-source fallback 也要走有效捕获绑定，否则拒绝控制。
- `ScreenShareManager.startShare / stopShare / recoverEndedTrack / destroy` 与 RoomScreenShareCoordinator 扩展每次 capture 的独立 shareSessionId；source 变化、track recovery 和 geometry 变化先 revoke，再发布新 metadata，重新申请。不能让自动恢复沿用旧 grant。
- grant 绑定 room Session ID、双方已证明身份与 memberGeneration、shareSessionId、target device、capture handle/geometryVersion、权限、expiry、grantGeneration；每条输入校验所有绑定、签名/MAC、单调 sequence、时效、速率与尺寸。时间使用本机 monotonic lease，远端 sentAt 只是辅助，不能靠两机墙钟完全同步。
- 每台被控端最多一个 active grant；原子 approve/revoke，pending request 有 deadline，重复/迟到拒绝，撤销先改本机 generation 再通知网络。恢复网络不能恢复 grant；必须新授权。
- viewer 采集 pointer/keyboard 前先确认 active grant、当前视频新鲜度与 focus。坐标按 object-fit 实际视频矩形去黑边、归一化到 [0,1]，Main 用当前可信 display bounds 转换 DIP/物理像素，再映射 Win32 virtual desktop absolute 坐标（包括负原点和高 DPI）；绝不直接使用 renderer window 像素。
- 普通键用受限 KeyboardEvent.code 映射 Win32 扫描码，文本/IME 如需支持仅通过有界 Unicode commit 协议；不记录文本。释放消息可靠、输入不得跨 grant 重放。窗口分享只读，不能通过 sourceId 前缀以外的未经验证自报绕过。
- Rust 使用 `Win32_UI_Input_KeyboardAndMouse` SendInput，检查实际成功数量和失败状态；UAC/安全桌面拒绝，不提权。平台 capability 增加 remoteInputSupported/permission 状态；macOS 当前无原生控制实现，必须明确只读，不能返回成功。
- 安全输入通道必须独立：当前 Core main 顺序执行 supervise_process，可阻塞很久；RustCoreClient.call 自动 retry host failure，非幂等 click/key 不得自动重试。输入 worker 有 active generation、会话 lease、按键/鼠标 owned state 和独立 watchdog；超时、EOF、父进程消失、lock/suspend、手动 revoke、worker 异常要释放 owned 按键。不能仅 kill worker 而忘记已按下修饰键。
- Main 用 powerMonitor lock-screen/suspend、BrowserWindow/room owner 销毁、分享结束、peer 离开以及紧急 globalShortcut 直接 revoke。紧急 shortcut 注册失败则不准启用控制；无需等待 renderer/远端 ACK。应用关闭清理有界，重启后无授权。
- 可复用 uiohook 观察本机抢回，但现有游戏逻辑会 suppress hook，不能把远控紧急停止依赖于它。要区分 injected 与本机输入，避免远端注入立即触发自身抢回。
- 视频无新帧/严重 RTT 或 relay 延迟则本机停止接收输入并 release-all。WebRTC Track live 不等于画面新鲜；结合 frame presentation / decoded frame counters；后台 UI 调度暂停时实时 watchdog 仍要运行。
- `ScreenSharePanel.tsx` 和 `ScreenShareViewerPage.tsx` 共用输入/申请组件；detached preload 仅增加受限、绑定当前 viewer/目标 share 的消息，回宿主后复用同一 coordinator，不创建第二套远程桌面引擎。

### 3.6 临时存储与 AI policy

新增纯 `roomSessionPolicy.ts`（共享或 Main/renderer 各消费的同一描述）：永久允许现有目录/历史/日报/上传；临时默认 session-memory chat/collection/local recording/local AI，显式个人 cloud provider 可用，永久云房间记忆/日报/自动摘要上传禁用。

- `server.ts` 的 join、acceptChatMessage、collection、dailyReports、recordingRecap、cloud AI 每条路径都按经过验证的 scope 分派；服务端临时历史只内存，有界、会话销毁一起清。不能只隐藏 UI 仍写永久 store。
- `useRoomState` 所有 onHistory/onChat/recall/send 后的 persistChatHistory 按 policy，临时默认不写永久 history key；个人可选导出或本地记录使用独立 Session ID key。
- `recording-library-core.ts:180,407` 需要 `isLocalRecordingRoomId` 可识别 temp；`recording-recap-publisher.ts:41` 必须继续只允许永久发布，不能简单放宽共享 isStoredRoomId 后把临时录音摘要自动上传。
- `recording-recap-upload.ts` 在 onCompleted 和实际 send 前双重检查 recording origin scope + 临时单次明确授权，不能只读全局 isAiAutoUploadEnabled。已有 automatic backlog/voice-memory-resume 必须继承 origin/policy，避免重启或历史补队绕过。
- 个人录音及模型、转录结果不会随 last leave 删除；房间 session 销毁只清临时通信与 grant。永久目录、账号凭据、favorites、历史和旧 room_/main/side 数据格式全部兼容。

## 4. 推荐落地顺序与每步闸门

1. **共享 types / policy / 纯状态机**：先写 code collision、前导零、5 席并发、last leave、30 秒 grace、锁/踢/换码/管理迁移、stale epoch、grant revoke/sequence/expiry 的独立测试。该步不改变现有音频路径。
2. **Identity + server temporary admission**：Main safeStorage、HTTP challenge/ticket、server 分流。集成测试在 production/account backend configured 下证明无账号可以进入 temp，但完全不能读/加入 room_；同 profileId 无 PoP 无法踢人；旧 token 不能复活被踢成员。头像与昵称边界测试覆盖。
3. **复用 RoomClient 启动 temporary online room**：transport/descriptor 注入、home/login gate、8 位创建加入、同 RoomPage；数据 policy 同时到位。真实 WS 5 客户端与第六拒绝、creator leave、reconnect，捕获磁盘写入证明未写永久存储。音频复用现有 fixtures。
4. **LAN endpoint/发现/认证/移交/公网登记**：多网卡、同码冲突、代码换码、grace、主动与 crash transfer、分区、stale leader 测试；只替换 signaling，不全房重连。公网登记保持 Session ID 和 track identity。
5. **DataChannel + share metadata + Main grant**：模拟输入 backend（永不实际 SendInput）验证 source-kind、sender、过期、重放、撤销/批准竞态、renderer 宕掉 watchdog、所有生命周期 revoke。保证非控制者仍观看和聊天。
6. **原生 SendInput 与受限界面**：先 Rust pure mapper / fake injector 验证坐标与 owned-key cleanup、deny、EOF、超时、batch 部分失败；人工授权测试设备再执行键鼠。两端 grant 和实际 input 成功分开统计；任何系统拒绝显示只读/失败。
7. **统一诊断和回归**：typecheck/lint/smoke/architecture ratchet/native/five-peer-audio/five-peer-media/build。仅在新增失败或新变化时重跑受影响集合；不把通过单元测试重复包装成真实设备证据。

## 5. 必须单独记录的验收与风险

| 场景         | 可自动化证据                                                                            | 必须真实环境证据                                                                                      |
| ------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 免账号与身份 | 隔离 profile 重启、加密私钥、无账号服务器 join、代码/限流/盗用重放                      | 两台电脑首次资料、上传头像、重启恢复；已有账号沿用且永久登录可用                                      |
| 离线 LAN     | UDP 解析/TTL、真实本机 socket、coordinator lease/epoch/quorum 故障注入                  | 两台或更多真实电脑断公网建房、数字码加入、音视频/聊天/控制；三台及以上协调故障恢复                    |
| 公网连接     | WS/ticket、强制 ICE/relay、per-peer fault、state cleanup                                | 不同 NAT 两网，选中候选类型、TURN 与应用 relay bytes、网络切换后实测恢复                              |
| 控制授权     | fake native backend：拒绝、取消、竞态、旧包、expiry、分享重启、窗口只读、focus/延迟暂停 | 两台授权电脑鼠标/拖拽/键盘/中文、负坐标/多显示器/100%-200%DPI、紧急停止、lock/sleep、系统拒绝         |
| 资源与性能   | 有界 queue/timer/listener/track 清理、五端合成链路                                      | 五人语音、一人屏幕四人观看一人控制、AI 并行、60min CPU/RAM/GPU/bandwidth/fps/latency/audio continuity |
| 永久回归     | 现有 62 项及新增 private/recording/cloud policy tests                                   | 旧资料、凭据、录音、频道权限、更新/安装行为；不能为了临时功能清空 profile                             |

主要实施风险不是“缺几个按钮”，而是身份与永久房间权限耦合、scope 数据边界、离线协调一致性、share/capture 的可信绑定、阻塞 Rust 队列与输入状态释放。以上任一未贯通都不能称完整交付。真实设备、真实 NAT、60 分钟 soak 不具备条件时必须明确列为未验证，不能以模拟代替。审核通过仍不代表获准发布；保留用户暂停发布要求。
