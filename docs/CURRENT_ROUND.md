# ShangHao 当前开发阶段

## 当前基线

- 当前基线：ShangHao 3.0.2 同版本修正版，完整继承 3.0.1 本地开发内容和 3.0.2 性能稳定改造。
- 本地工作区是唯一最新基线；不从远端覆盖本地，不重建项目。
- 用户已明确授权：全部修复和发布检查通过后，打包 Windows EXE、推送 GitHub 并发布 v3.0.2。
- 不删除既有语音、屏幕分享、录音、AI、角色资源或用户数据；发布包不包含本地模型和用户数据。

## 本轮重点

- 保持五人 WebRTC Mesh、后加入音频、ICE/TURN/Relay、AEC/DeepFilter/VAD/双讲与响度平衡。
- 降低房间切换、离开座位、收藏/录音库和屏幕分享时的整页重渲染与高频 IPC。
- 将屏幕帧新鲜度与兜底画面刷新限制在屏幕分享子树。
- 审计 Zustand 订阅、成员对象身份、角色 memo、VisualRuntime/rAF、Overlay 心跳和后台任务。
- 保持日历、天气、时钟、角色动画、玻璃材质和高分辨率资源的现有视觉质量。

## 已完成（本地）

- RoomPage 音频 store 改为字段选择器。
- RoomPage 移除屏幕帧 1 秒时钟；屏幕分享由 `ScreenSharePanelContainer` 独立承载。
- 成员比较移除 `JSON.stringify`，未变化成员复用原对象；重复屏幕帧不再创建新状态。
- Overlay 后台 reconcile 心跳改为 2 秒，状态变化仍即时同步。
- SceneCharacter 增加稳定字段比较 memo；语音光环仍使用 CSS 变量路径。
- “上号”快捷语音只做 -5 dB 局部增益修正。
- 增加 Character Pack Protocol 类型和 3.0.1 性能基线记录模板。
- 分离窗口同步合并为 200ms 批次，避免 Relay 帧变化直接放大为 IPC 高频调用。
- RuntimeHealth 增加 GPU compositing、rasterization、WebGL/WebGL2、视频编解码和 ANGLE/backend 字段。
- 麦克风保护分析、VAD/回声证据与原声/DeepFilter 混音迁移到 AudioWorklet 音频时间轴，移除视觉 rAF 驱动。
- 屏幕 relay 改为 250ms 单飞捕获，避免 JPEG/IPC 重叠；fallback 保留并显示“网络受限 · 备用画面”。
- RoomPage 设置订阅拆为精准 selector；新增 RoomPage、TeamIsland、SceneCharacter、ScreenShare Render 计数与变化原因诊断。
- Long Task 诊断增加 50ms 阈值与 JS/Canvas 等分类，诊断数据进入 RuntimeHealth，不驱动房间业务状态。
- 角色换座改为合成层路径，空闲叠层动画默认停用；空闲 GPU 占用恢复后只在角色实际移动期间短时升高。
- 修复静音成员已连接但被音频就绪看门狗反复重建，以及旧信令会话继续保留定时器和 Peer 的问题。
- 中文录音转录与 Qwen 整理拆分为独立任务，补齐音频转换、模型切换、失败原因和低优先级调度。
- 修复首批 3.0.2 安装包 Qwen runner 与清单 SHA256 不一致导致的 `ai_runtime_integrity_failed`；AI runtime 失败不再阻止主客户端启动。
- 新增源码 runner 与清单哈希测试、安装包真实 runner 哈希检查，并补充 `docs/stabilization-reference-3.0.2.md` 作为后续排查基线。

## 验证边界

- 自动化测试通过只说明代码路径和约束符合预期，不等同于真实设备听感已经验证。
- 音质、回声、吞字、降噪强度、双讲保护及五套不同设备组合，仍需真实设备试听。
- 长录音转录质量和多显示器屏幕分享声音，仍需在目标 Windows 设备上继续体验验证。
- AI 模型、转录数据、录音、聊天记录和用户设置均保持为本地数据，不纳入源码提交和安装包替换范围。

## 自动化验证

- ESLint、Prettier、全工作区 typecheck 和 `git diff --check` 已通过。
- `corepack pnpm --dir apps/desktop test:smoke` 已通过，354/354。
- Electron AudioWorklet 48 kHz、五人音频 20 条定向链路、五人媒体 20/20 流和恢复场景已通过。
- Rust 原生核心 2/2、生产构建、Windows NSIS 打包、执行级别和安装包运行依赖检查已通过。
- FPS、1% Low、P95/P99、GPU/VRAM、五人真人听感、120/144Hz、长时运行必须在真实设备上采样，当前均不冒充已验证。
