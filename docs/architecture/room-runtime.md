# 房间运行时架构

本文记录 v2.8.0 完成后的房间侧职责边界。它描述现状与维护规则，不改变产品行为。

## 依赖方向

```text
RoomPage / Room UI
        ↓
useRoomState 与独立 hooks
        ↓
RoomClient（稳定门面）
        ↓
Chat / Signaling / Peer Queue / Screen Share
        ↓
WebRTC / IPC / Storage
```

下层模块不应反向依赖 `RoomPage` 或 `useRoomState`。Renderer 仍通过 Preload 的窄 IPC 使用系统能力。

## RoomClient

`RoomClient` 继续是房间通信的统一入口，保留连接、离开、聊天、屏幕分享、成员状态和音频轨道等现有公开 API。内部职责由以下模块协作：

- `SignalingBridge`：Signaling 连接、会话隔离、事件订阅和串行分发。
- `PeerOperationQueue`：同一 Peer 的 offer、answer、ICE 与恢复操作串行化。
- `ReliableChatTransport`：消息 ID、ACK、超时、重试、重连续发和去重。
- `ScreenFrameRelay`：屏幕帧兜底采集、压缩和定向发送。
- `ScreenAudioMixer`：屏幕分享期间的麦克风与系统声音混音生命周期。
- 现有 WebRTC、音频处理、RemoteAudioMixer 和录音模块继续独立，不迁入 RoomClient。

## React 层

- `RoomPage` 负责页面组合、可见状态和交互编排。
- `ScreenSharePanel` 负责屏幕分享查看区域及其拖动、分离交互。
- `AudioControlPopover` 负责麦克风和扬声器设置浮层。
- `useRoomState` 仍是房间会话协调 Hook，但本地聊天持久化、成员音量持久化、系统通知和 Deep Link 已交给独立模块。
- `roomStore` 是房间连接状态与生命周期状态的唯一 UI 状态源；页面只读取，不复制维护另一套状态机。

## 动画

- 角色路径与中断规则集中在 `characterMotionRuntime` 和 `SceneCharacter`。
- 动画只使用 `transform`、`opacity` 等合成友好属性完成现有效果。
- GSAP 动画必须通过 context 清理；组件卸载或动作被打断时必须停止旧控制器。
- 保留 reduced-motion 分支，不删除现有动画，也不通过缩短效果规避性能问题。

## 行为保护线

- 不重写五人 Mesh、ICE restart、TURN、relay fallback 或 RemoteAudioMixer。
- 不改变可靠聊天的 ACK、retry、dedupe 和历史记录语义。
- 不改变屏幕分享传输方案、系统声音混音比例或来源选择流程。
- 不把录音、DeepFilter、AEC 或 AI 模型任务迁入 RoomClient。
- 新模块不得记录聊天正文、录音内容、AI transcript 等隐私数据。

## 后续拆分原则

`RoomPage`、`useRoomState` 和 `RoomClient` 仍然较大，但剩余代码包含紧密耦合的页面编排、会话生命周期和 Peer 协调。后续只有在具备对应行为测试时，才继续按成熟职责渐进抽离；不要按行数机械拆文件。
