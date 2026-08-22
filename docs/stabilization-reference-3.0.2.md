# ShangHao 3.0.2 性能与启动故障参考

本文记录 3.0.2 发布前后的两类真实故障、代码根因、修复边界和回归检查。后续若再次出现“进房猛卡、换座掉帧、空闲风扇持续转”或更新后无法启动，应先按本文核对，不要先删用户设置，也不要用动态模糊掩盖掉帧。

## 一、房间卡顿的实际表现

- 点击上号进入房间时会突然卡一下。
- 角色换座和移动明显不跟手，在高刷新率屏幕上仍能看到跳帧。
- 房间静止、无人说话时仍有后台占用，风扇持续升速。
- 切换设置、录音库、收藏或屏幕分享时，整页有额外重绘感。

这些现象不是单一毛玻璃样式造成的。录屏和代码路径对照后，确认是渲染循环、持续动画、过宽状态订阅、屏幕帧 IPC 和连接恢复循环同时叠加。

## 二、已确认根因与修复

### 1. 角色位移占用 Renderer 帧

旧路径由 React/Framer Motion 驱动角色位置，并在动画更新过程中读取位置；移动元素上的滤镜和长期 `will-change` 又会增加每帧栅格化与合成压力。

修复：

- `SceneCharacter` 使用 Web Animations API 的 transform-only keyframes。
- 路径运行交给 Chromium compositor；只有动画被打断时才读取一次当前矩阵位置。
- 角色真正行走时才启用合成层提示，静止后立即释放。
- 移动物体不再携带每帧重绘的 drop-shadow/filter。

关键代码：

- `apps/desktop/src/renderer/src/components/room/SceneCharacter.tsx`
- `apps/desktop/src/renderer/src/features/voice-scene/characterMotionRuntime.ts`
- `apps/desktop/src/renderer/src/styles/parts/50-character.css`

### 2. 静止角色仍持续多层动画

角色坐下或静音后，头、身体、尾巴等图层仍以不同周期无限动画。五个角色同时存在时，即使房间无人操作也会周期性触发 compositor/raster 峰值。

修复：

- 默认 idle 与 muted 多层循环停用。
- 保留说话、游戏、行走和明确交互反馈。
- `will-change` 只在 walking layer 活跃时启用。

### 3. 语音活动分析跟随显示器刷新率

旧 speaking detector 使用 `requestAnimationFrame`。在 120/144/160Hz 屏幕上，音量分析会按屏幕刷新率运行，但语音状态并不需要这么高的频率。

修复：

- speaking analysis 固定为约 30Hz（33ms）。
- 音量发布继续限频，保留低于 50ms 的说话反馈。
- 麦克风保护、VAD、回声证据和 raw/DeepFilter 混音迁移到 AudioWorklet 音频时钟，不再依赖视觉 rAF。

关键代码：

- `packages/webrtc/src/speaking.ts`
- `apps/desktop/src/renderer/src/features/audio/microphoneProcessor.ts`

### 4. RoomPage 与屏幕帧放大重渲染

旧 RoomPage 订阅完整 settings/audio 状态，屏幕兜底帧和新鲜度时钟也在页面根部更新；分离窗口同步可能随 JPEG 帧触发 IPC。

修复：

- Zustand 改为字段 selector，成员和帧对象使用结构共享与重复帧去重。
- 屏幕帧时钟与 fallback 选择移入 `ScreenSharePanelContainer` 子树。
- 分离窗口同步合并为 200ms 批次；relay capture 使用 250ms single-flight，禁止 JPEG/IPC 重叠。
- Overlay 低频 reconcile 从 250ms 调整到 2s，真实状态变化仍即时同步。
- 移除高频 `JSON.stringify` 依赖键，事件回调保持稳定引用。

### 5. 静音 Peer 被误判为坏连接

ICE/DTLS 已连接的成员在静音或没有非零 PCM 时，旧看门狗仍可能认为音频未就绪并周期性重建 Peer，造成后台 ICE、信令、音频图和 UI 状态抖动。

修复：

- transport connected 和 RTP 增长作为连接健康证据。
- 静音或正常安静不触发 Peer 重建；relay readiness 仍独立控制音频回退。
- 恢复只针对真实 stalled peer，不波及其他成员。

### 6. 被替代的房间会话没有完全停止

热更新、快速切房或重建 RoomClient 后，旧客户端失去主进程信令所有权，但旧计时器、Peer、音频回退和屏幕分享资源可能继续工作。

修复：

- 识别 `signaling_session_superseded` 后将旧客户端彻底惰性化。
- 停止 snapshot、heartbeat、audio path sync、stats 和 reconnect。
- 销毁 Peer、fallback、screen tracks、screen mixer 和 pending chat。
- 不回调新页面的 UI 清理，避免旧会话反向擦掉新房间状态。

关键代码：

- `apps/desktop/src/renderer/src/features/room/roomClient.ts`
- `apps/desktop/src/renderer/src/features/room/signalingSessionOwnership.ts`

## 三、为什么没有增加动态模糊

动态模糊只能降低肉眼对离散位移的敏感度，不能消除主线程阻塞、重复 Peer 恢复或持续重绘；在 Electron/Chromium 中还可能增加滤镜栅格成本。3.0.2 选择先修真实帧源和后台循环，角色移动保持 transform/opacity 合成路径。

## 四、3.0.2 更新后启动失败事件

### 表现

正式版从 3.0.0 更新到首批 3.0.2 后，启动弹窗显示 `ai_runtime_integrity_failed`。

### 根因

安装包中的 `qwen-runner.py` 已更新，但 `resources/ai/runtime-manifest.json` 仍保存旧 SHA256。程序按清单校验时正确发现不一致，却错误地把可选 AI 组件故障升级成整个客户端启动失败。原有发布检查只验证哈希字段格式，没有把清单值与打包后的真实文件重新计算比对。

### 修复

- 清单更新为实际 runner 的 SHA256，并记录正确 packageVersion。
- 单元测试直接计算源码 runner 哈希，脚本变化但清单未更新时立即失败。
- 打包后再次计算 `resources/ai/qwen-runner.py` 哈希，与安装包清单逐字节比对。
- 正式环境只允许 `prepareBundledAiRuntime` 在校验通过后替换持久化 Qwen runner，移除后续未校验的重复覆盖。
- 可选 AI runtime 准备失败时记录具体路径和原因，但主客户端继续启动；语音房、聊天和录音不再被 AI 组件拖死。
- 不删除 `settings.json`、录音、聊天、模型或转录结果。

## 五、以后遇到类似问题的排查顺序

1. 先记录版本、发生时间、操作步骤，以及空闲/进房/换座/屏幕分享中的具体阶段。
2. 查看诊断中的 Renderer FPS、Long Task、GPU compositing、WebRTC recovery 和后台 AI 状态。
3. 检查是否存在显示刷新率驱动的非视觉任务、无限 CSS 动画、长期 `will-change`、根页面宽订阅或帧级 IPC。
4. 检查旧 RoomClient 是否停止、静音 Peer 是否仍进入恢复队列。
5. 打包问题必须对 `win-unpacked` 内真实文件做哈希与依赖验证，不能只验证源码或清单格式。
6. 自动化结果只证明约束路径；真实 60/120/144Hz FPS、1% Low、P95/P99、GPU/CPU 和五人长时语音仍需目标设备采样。

## 六、固定回归保护

- `character-motion.test.ts`：角色路径、可打断移动、transform-only compositor keyframes。
- `motion.test.ts` / `room-layout.test.ts`：移动期间合成层、静止角色不持续重绘。
- `network-adaptation.test.ts` / `connection-core.test.ts`：静音、RTP、stalled peer 与恢复边界。
- `signaling-client-race.test.ts`：过期信令会话不能影响当前会话。
- `ai-runtime-package.test.ts`：runner 与 manifest 哈希必须一致。
- `scripts/verify-packaged-runtime.mjs`：安装包内 AI runner、字体、DeepFilter 和许可证完整性。
