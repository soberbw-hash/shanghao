# 选定应用声音与音乐分享：只读接入审计

日期：2026-10-22。范围：现有屏幕声音、发送混音、Rust Core、聊天链接卡与官方进程音频捕获接口。本次只新增本文件，没有实现捕获、操作真实播放源或改变媒体路径。

## 结论

可以在 Windows 上实现“选 QQ 音乐、网易云、Apple Music、酷狗、Spotify、汽水或其他应用，把该应用声音与自己的话音一起发进房间”。现有 Electron 屏幕声音入口不能承担进程隔离；需要新增原生进程树捕获，再接入一个有明确所有者的发送混音图。独立分享增益应位于应用声音输入分支，不改变系统或源应用本地音量。

最小方案沿用当前一条房间发送音轨与现有 Mesh/Relay 替换事务，不要求安装驱动、虚拟声卡、.NET 或 SoundRelay。这能满足选源、边说话边分享、分享音量、停止与退出收尾；它继承现有语音编码音质，不能宣称立体声或音乐保真。若要求收听方独立调整“人声/音乐”，或保真音乐，须另行设计音轨标识、接收混音和 Relay 协议，不能靠一个增益滑块完成。

## 本地证据与当前缺口

以下位置是本次读取的工作区快照，后续修改会使行号移动。

| 入口                                                                                    | 当前行为                                                                                 | 接入约束                                                          |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/desktop/src/main/window.ts:461`                                                   | 校验请求 frame 后，画面使用选定源；声音在 485 行固定返回 `"loopback"`                    | 选窗不等于选该窗声音；不能把这个选项命名为“仅此应用”              |
| `apps/desktop/src/main/screen-capture-service.ts:42`                                    | 枚举屏幕/窗口、缩略图与图标；最多 24 个；描述符不含可靠 PID/创建时间                     | 音乐进程列表应独立，不能继承 24 项图像源截断或默认主屏回退        |
| `apps/desktop/src/renderer/src/features/screen-share/ScreenShareManager.ts:141`         | `getDisplayMedia({video:true,audio:includeSystemAudio})`；失败重试时可去掉声音           | 应用声音应能纯音频分享；失败不得转成全系统 loopback               |
| `apps/desktop/src/renderer/src/features/screen-share/RoomScreenShareCoordinator.ts:123` | 屏幕音轨与主输入混音；停止时恢复主输入                                                   | 停屏幕时不得把仍在分享的应用声音一并清掉                          |
| `apps/desktop/src/renderer/src/features/screen-share/ScreenAudioMixer.ts:22`            | 新建约 32 kHz 图，麦克风增益 1，系统音增益固定 0.72，输出 `speech`；原图在替换成功后释放 | 可复用候选图提交/失败保留旧图原则；没有可调分享音量或多来源组合   |
| `apps/desktop/src/renderer/src/features/room/roomClient.ts:481`                         | 换麦仅重建屏幕声音混音；1662 行统一替换 Mesh 与音频 Relay 发送源                         | 应用声音必须加入换麦、断线恢复、离房和旧会话失效的同一资源归属    |
| `apps/desktop/src/renderer/src/features/audio/replaceOutgoingAudioTrack.ts:5`           | 等待各发送端替换，失败回滚；恢复麦克风时允许健康端前进、失败端定向恢复                   | 不重写已验证事务；新来源只提交新的完整候选发送轨                  |
| `native/crates/shanghao-core/src/main.rs:93`                                            | 只有活动、文件身份和子进程监督能力；365 行是同步 JSONL 命令循环                          | 尚无 WASAPI、持续 PCM 或可停止的捕获会话                          |
| `apps/desktop/src/main/rust-core-client.ts:169`                                         | 有超时/取消/重启界限的 JSONL RPC；257 行按 JSON 解 stdout                                | 不能把 PCM 直接塞进当前 JSONL stdout；其 4 MiB 护栏也不是音频背压 |

Electron 版本已从本地依赖核验为 42.11.8。该版本官方文档与本地 `electron.d.ts:23650` 都规定 `audio: "loopback"` / `"loopbackWithMute"` 是系统声音；另一种 `WebFrameMain` 只捕获自身 Electron `webContents`，不能指定外部音乐程序 PID。[Electron 42.11.8 文档](https://github.com/electron/electron/blob/v42.11.8/docs/api/session.md#sessetdisplaymediarequesthandlerhandler-opts)

音质还有三个已确认的限制：`packages/webrtc/src/createPeer.ts:101` 强制单声道、Opus 24 kbps、DTX 与 32 kHz 播放上限；`configureAudioSender` 再设 `speech`；`signalingAudioRelay.ts:69` 的回退为 16 kHz 单声道。原生采成 48 kHz 双声道并不自动改变这些条件。接收侧还有朋友响度平衡、主增益和限幅，需对音乐与同时讲话做听感验收。

## 官方 Windows 接口与限制

微软提供 `ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, IID_IAudioClient, ...)`。激活参数是 `VT_BLOB` 包裹的 `AUDIOCLIENT_ACTIVATION_PARAMS`：类型为 `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`，目标为选定 PID，模式固定 `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`。不要开放反向的 EXCLUDE 模式；它会包含目标以外声音，与本需求相反。[官方激活 API](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-activateaudiointerfaceasync)、[参数结构](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params)

官方 ApplicationLoopback 示例直接演示单进程树包含/排除，说明捕获不绑定某个物理输出端点，目标没有渲染流时返回静音。该能力不需要把声音先路由进虚拟麦克风。[微软示例说明](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)

- 系统门槛：示例、参数与枚举文档标注 build 20348；激活函数页另写 20438，存在官方文本差异。应以保守系统检查加实际激活成功为准，返回结构化不支持错误；不能仅以“Windows 10”标签承诺支持，常见 1904x 构建低于这个范围。本机只读结果为 `10.0.26300`、x64，满足数字门槛，但本次没有激活捕获。
- 子进程：接口的 INCLUDE 模式是进程树，不能声称排除子进程；一个浏览器进程树可能包含多个标签页。UI 应写“分享此应用声音”，不能写“仅此网页/窗口声音”。不提供含混的“是否包括子进程”开关冒充原生精确能力。[模式定义](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-process_loopback_mode)
- 音源定位：窗口拥有者 PID 不一定是渲染 PID。Apple Music 的宿主窗口和采用独立音频进程的程序需核对音频会话；可用 `IAudioSessionManager2` 枚举配合 `IAudioSessionControl2::GetProcessId`，但该方法还会返回跨进程会话的成功状态 `AUDCLNT_S_NO_SINGLE_PROCESS`，不能把一个返回 PID 当作万能应用身份。[会话 PID 官方定义](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid)
- 权限、独占与受保护输出：对拒绝、受保护内容、声音服务中断等给出可操作错误或静音状态；不能保证所有 Apple Music/Spotify 曲目可捕获，也不绕过 DRM。[微软 loopback/DRM 说明](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)
- 激活完成在 COM MTA 回调执行。保留 callback/operation/参数内存直至完成，设置启动超时与取消代际；迟到成功只释放自己的新对象，不能复活已停任务。COM 客户端在所属线程使用/释放，不对接口随意增加 `Send`。
- 从 `IAudioCaptureClient` 按包读取，处理 SILENT（补零）、DATA_DISCONTINUITY（统计并重置边界）、TIMESTAMP_ERROR；每次成功取得的包成对 ReleaseBuffer，避免长时间持有系统缓冲。[GetBuffer 官方约束](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)

## SoundRelay 来源与许可

已定位 [Nitro70/SoundRelay](https://github.com/Nitro70/SoundRelay)，本次 GitHub API 返回 main 提交 `3d5daea714231382b82342768dcbad915bc076aa`，提交时间 2026-09-28。核验其实际 LICENSE 为 MIT，版权为 2026 Nitro70；不是仅凭 README 的许可标签推断。若将来复制实质代码须保留其版权及许可文本。[固定提交 LICENSE](https://github.com/Nitro70/SoundRelay/blob/3d5daea714231382b82342768dcbad915bc076aa/LICENSE)

其 `SoundRelay.csproj` 是 .NET 10/WPF，依赖 NAudio 2.2.1。README 的虚拟声卡场景是把声音送给“别的软件的麦克风”，不适用于上号自身持有 WebRTC 发送轨的最小路径。可参考其“选择进程、增益、停止”产品行为；本次未复制、下载或执行它的代码/二进制，不引入 .NET/WPF/NAudio 或第三方驱动。[项目依赖](https://github.com/Nitro70/SoundRelay/blob/3d5daea714231382b82342768dcbad915bc076aa/src/SoundRelay/SoundRelay.csproj)

微软 [Windows-classic-samples LICENSE](https://github.com/microsoft/Windows-classic-samples/blob/434f6002bdf9cf9829406c3ff2b33387982d6168/LICENSE) 同样为 MIT；优先依据官方 API 定义独立实现。现有 Rust 只启用 windows-sys 0.61 的文件/进程/窗口功能；新增 Windows 专用音频模块可使用微软 windows-rs 的类型化 COM 绑定，精确启用 Audio/COM/StructuredStorage 等实际所需功能并锁定兼容版本。官方发布的 `windows` 0.62.2 文档确认激活函数、参数结构及 `IAudioClient` 均可用，但本次没有编译验证锁定版本及最小 feature 集合。[微软 Rust 绑定](https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/Media/Audio/fn.ActivateAudioInterfaceAsync.html)

## 最小可实施接入方案

### 1. 明确类型与枚举所有权

新增 `shanghaoCore.applicationAudio` 能力：`getCapabilities/listSources/start/stop/setGain/onState`，类型集中在 shared，Preload 只暴露这些固定能力。返回 `unsupported_os/native_unavailable/source_exited/source_identity_changed/activation_failed/capture_failed/superseded` 等稳定错误码。

Main 枚举音频会话、可见/后台音乐进程与原生已有 `activityProcessSnapshot()`；窗口标题/进程名只是显示及分组依据。源描述符使用 Main 生成的短期 opaque `sourceId`，服务端保存 PID、创建时间、可执行身份、必要的宿主映射和列表代际。开始时重新核验，不接受 Renderer 提供任意 PID、可执行路径、shell 命令、模式或输出文件。排除上号自身和其子进程，阻止把房间回放再次发回房间。

预设品牌只帮助找到正在运行的程序。当前 `game-detection.ts:76` 与 shared `MusicProviderId` 只有 Spotify/网易/QQ/Apple，且用于“正在听”状态，不是捕获授权。酷狗、汽水与其他程序不应被硬编码品牌白名单挡住；以真实进程/会话选择作为基础，后续才加经核验的别名和图标。不能仅靠“标题包含 Apple Music”选中共享宿主。

### 2. 原生进程捕获与有界 PCM

建议新增 Rust Windows 专用模块，使用现有 `shanghao-core.exe` 的独立固定 capture 子模式，由 Main 专属 `ApplicationAudioService` 启动隐藏子进程。普通 JSONL CoreHost 仍只负责短请求；持续捕获不会阻塞已有活动/文件 RPC。子模式 stdin 接受固定 stop 控制，stdout 为有版本/长度界限的二进制帧，stderr 为有界状态，不混合日志与 PCM。

独立 capture 进程至少持有目标进程 HANDLE 与创建时间；观察源退出、控制管道 EOF 和 Main 关闭。源关闭后即使有音频子进程存活也按本次选源会话策略结束，不按 exe 名自动追踪重启的新进程。窗口最小化/关闭到托盘但进程仍运行不等于退出。无新音频包可能只是暂停音乐，不能以短静音当作退出。

参考官方 [LoopbackCapture.cpp](https://github.com/microsoft/Windows-classic-samples/blob/434f6002bdf9cf9829406c3ff2b33387982d6168/Samples/ApplicationLoopback/cpp/LoopbackCapture.cpp) 的 Shared/EventCallback/Loopback 初始化路径：启动先协商固定 PCM 格式（建议 48 kHz、双声道），不假定 GetMixFormat 或某一种 float 格式必定成功；不支持时明确失败或做受控格式转换。官方例子使用的是 44.1 kHz/16-bit PCM，这不等于必须照搬其落盘 WAV 流程。

Main 将经过校验的 PCM 经专属 MessagePort 交给本次主 Renderer，再转给 Worker/AudioWorklet。Electron 支持 Main/Preload/Renderer 之间移交端口；不能用普通 contextBridge invoke 假装转移 MessagePort，也不要承诺主进程到 Renderer 的所有缓冲都是零拷贝。[Electron MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports)

帧头包含 sessionId/格式版本/序号/时间戳/样本帧数；批次长度和通道数固定验证；Main 与 Worklet 都限制队列（例如约 80–120 ms 的目标缓冲与 250 ms 硬上限，最终值需实测）。拥塞时丢旧帧保实时，不无限 pause 系统捕获线程；终止或代际变化立即拒绝旧帧并清空队列。没有必要开本地 TCP 端口、输出临时音频文件或记录 PCM 日志。

`phoneMicUsbReceiver.ts:15` 已有 Worker → MessageChannel → AudioWorklet → MediaStreamDestination 的可参考所有权结构，但其实现是单声道手机麦克风，不能直接将其状态机/1928-byte 网络帧当作应用音频协议。

### 3. 一个发送图组合所有来源

新增独立的 `ApplicationAudioController`（选源、停止、状态代际）与应用 PCM Receiver；房间发送组合器统一接入“当前处理后的麦克风 + 可选屏幕声音 + 可选应用声音”。应用声音在麦克风 DSP **之后** 加入，不经过 AEC/DeepFilter/VAD 人声降噪，也不能改变主麦克风设备或处理参数。

增益用保存下来的应用分支 `GainNode` 平滑变化，限制范围并拒绝 NaN；不反复更换 Track，不调用 Windows 每应用音量/静音。只把声音送向发送目标，不接本地扬声器；源应用本来已经在本机播放，再监听一次会重复。重建图时保留当前分享增益与源代际。

具体改动点是 `roomClient.applyOutgoingAudioTrack` 前的来源组合层，以及 `replaceInputTrack`、屏幕 start/stop 回调和 leave/superseded 收尾。停止某一来源只移除该来源：停屏幕仍应继续应用分享，停应用仍应保留屏幕音和人声。组合器持有输出轨，各来源控制器只持有自己的采集资源；绝不能让 ScreenAudioMixer 与另一个混音器轮流替换同一发送 Track、嵌套彼此输出或分别恢复麦克风。

开始分享先准备原生会话与候选图，经现有 `replaceOutgoingAudioTrack` 全目的端事务提交后公布“分享中”；失败清理候选并保留原有话音。停止先切断应用 PCM/清空播放队列保证不继续泄露，再提交不含应用的图；失联 Peer 按已有恢复机制处理，不能为它回滚健康成员到要关闭的混音轨。

本地麦克风静音/PTT/听筒静音必须分别验收。`useLocalAudioTransport.ts:75` 会切本地输入 Track.enabled，`roomClient.updateMuteState` 也会静音 Relay：即便 WebRTC 中混入音乐可继续，Relay 仍可能整体被静音。需要把“麦克风分支静音”与“停止应用分享”语义分开，保持两条传输路径一致；不能只看有增益波形就宣称成功。接收侧 speaking/muted 还参与响度证据，不能把音乐峰值当作成员讲话证据。

### 4. 房间状态与兼容性

第一版发送者只拥有一个应用来源，明确展示应用名、分享音量、实际状态和停止入口；重开页面不得自动捕获上次程序。进房、换房、离房、Renderer 刷新/崩溃、Main 关闭、原生退出、超时均使本次会话失效。旧任务回调无权清理新房/新来源。

分享状态需使用明确版本化的可选字段（来源显示名、sessionId、是否分享），旧客户端安全忽略；本地绝对路径、窗口私密标题、PID/创建时间不广播。PCM 与话音沿既有 Mesh/Relay 发送；不要另外通过聊天消息或屏幕截图 Relay 塞音频。若当前协议不允许新增状态字段，先补兼容校验与测试，不发未识别消息。

macOS 当前 `systemAudioLoopback:false`，本次 Windows 实现不能翻转此项假装跨平台支持。新增 `applicationAudioLoopback` 应独立于现有 `systemAudioLoopback`，有系统版本与原生能力检测。不支持时可继续分享聊天音乐链接，不自动降级全系统声音。

## 聊天音乐链接现状与最小增强

当前 `TemporaryChatPanel.tsx:93` 的 `MessageLinkPreview`、`features/chat/linkPreview.ts`、Main `chat-link-preview.ts` 已支持首个 HTTP(S) 链接、普通标题/OG 封面/站点图标、外部打开、复制与拖入收藏。Main 限制地址、重定向、超时与响应大小，并使用 `public-network` 防止访问私网。`chat-link-metadata.ts:31` 能读 title/description/siteName/image，但当前卡片主要显示标题/图片/网址。

目前没有音乐平台专用曲目解析、歌手字段、播放/暂停控制、房间同步播放或 QQ/网易/Apple/酷狗/Spotify/汽水专属卡。现有音乐快捷语音包与“正在听”标记不能当作上述能力。

最小增强可先独立增加受测的音乐 URL 分类与明确平台标记，沿用原链接与现有公开 OG 元数据。匹配解析后的 hostname/明确路径，支持官方短链的受限公共重定向，防止 `y.qq.com.evil.test` 误判；不要抓 cookie、解密登录态、绕过会员或自动启动音源捕获。元数据失败仍保留可点击原链接。具体平台域名和深链规则应逐一以其官方分享链接做夹具核验，本次未验证六个平台的登录/会员链接可用性。

## 验证结果与完成门槛

本次运行现有定向测试：screen-share-manager、screen-share-manager-lifecycle、screen-share-coordinator-races、room-screen-share-stop、input-track-replacement、chat-links、chat-link-metadata、chat-link-preview、rust-core-host，共 39 项通过。只说明既有代码的这些夹具通过，不是新增应用捕获的验证。本次未安装依赖、编译原生捕获样例、抓取用户真实声音、启动音乐程序或连接远端朋友。

实现后至少补齐以下证据，不能以单机波形替代远端听到：

1. 两个独立可控进程播放不同频率，选 A 时捕获输出只含 A；系统提示音、B、房间回放不出现。覆盖子进程、PID 复用、源最小化/托盘、源退出/同名重启。
2. 麦克风与应用同时发送；分享音量不改人声和本机应用音量；PTT/麦克风静音在 Mesh 与强制 Relay 下一致；停分享后麦克风继续且无队列尾音。
3. 连续启动/停止、开始中取消、换源、换麦、停屏幕、离房/换房、断网恢复、原生崩溃、关闭 Renderer 等竞态；句柄、进程、端口、Context/Worklet/Track 和缓冲均有界释放。
4. 六种音乐程序分别做播放/暂停/退出、宿主/子进程映射、耳机输出设备切换及受保护内容失败检查；不能把“已发现进程”写成“该程序已支持并实测”。
5. 适当的 TypeScript/定向测试、smoke、五人自动音频/媒体回归，以及至少两台真实设备的实际听感；长时间延迟、断续、响度和分享者说话时音乐变化单独记录。音乐保真要求若超出现有语音通道，单独批准协议/编码方案后实现。

本审计给出可实施边界；应用捕获功能尚未交付，真实设备与平台曲目兼容性仍未验证。审核通过也不构成发布授权。
