# 整理重试、阅读列表与调度诊断

本轮不修改 ASR 参数、阅读分段规则、实时音频处理或动画，不发布 Release。

## 确认存在并修改

- 整理分块只有单轮两次上限：增加累计六次预算及 `unrecoverable`，普通 failed 仍可继续；启动推理前保存次数，跨进程恢复不补发预算。已有手动整理入口可解除耗尽状态。分块、分层汇总和单次整理入口均检查预算；汇总成功的中间结果也持久保存。
- 整理内层保存失败状态后，外层用旧记录覆盖：错误捕获后重新读取持久化记录，保留累计次数和已完成分块。
- 全量 map 生成阅读 DOM：使用 react-virtuoso 4.18.13 的动态行高列表，复用原滚动容器、段落样式与起点跳转。稳定 memo 行、父组件 useCallback，不修改时间轴数据。
- IPC structured clone 使相同转录失去引用：在接收端比较 transcript/speakers 子树，完全相等才复用引用。时间戳、words、昵称等变化不会隐藏；不是重构 Zustand。
- Scheduler 没有拒绝历史：只在内存累计决策拒绝次数、有限原因分类、最近原因与时间。通过现有 AI snapshot 读取，诊断卡片挂载时及每十秒查询一次，不重叠请求、不每次拒绝写日志/磁盘/IPC。相同计数不触发卡片状态更新。计数是决策次数，不是任务数，重启清零。

## 检查后保留

- 现有自然段生成 useMemo 的依赖写法正确；问题在 IPC 引用，分段算法无需修改。
- VoiceMemoryDetail 原来没有当前播放段落高亮或播放跟随滚动状态，不宣称“保留”不存在的功能，也没有新建一套播放器状态。
- 原生 button 的点击、Enter/Space 保留；虚拟列表补充 Tab/Shift+Tab 跨未挂载行的定位。
- 持久化为可扩展 JSON 记录，没有限制 chunk status 的独立 schema。旧 pending/running/completed/failed 仍接受；新增状态只影响整理，现有 ASR 状态不改。旧 failed attempts >= 6 在下一次尝试前转为终态。

## Abort 事实及本轮边界

- ASR/整理信号已传到单次运行请求，不只是单元间检查。
- asr-persistent-worker 和 qwen-persistent-worker 当前在运行中取消会结束子进程；排队取消只移除请求。完成时清 timer/listener/active 状态，已有空闲复用逻辑保留。
- 两个 Python runner 同步读取 stdin、执行推理、返回结果；没有并发接收 cancel 消息的协议，也没有统一模型级停止接口。仅新增 cancel 消息不能打断当前推理。
- FreeToken 接口把 signal 传给 fetch，但 HTTP 取消不等于已经证实 FreeToken 后端立即停止 GPU 推理。实时压力触发的既有 release 路径也仍然存在。
- 本轮没有更改 Worker/Python 取消实现，没有新增频繁重启行为；也**没有实现取消后保留模型的协作取消**。实现它需要逐后端的可中断推理协议，不能在全模型测试途中安全地用统一假 cancel 代替。
- 当前主动 Abort 不等待自然完成，而沿用进程终止。若改成仅单元间取消，等待上界可能达到请求超时：ASR `max(240000, durationMs*8)` 毫秒，单次整理四分钟，分块整理三十分钟；这些是配置上限，不是实测平均延迟。不能承诺仅等几秒。

## 验证

- 542 项桌面回归测试通过。
- workspace typecheck、本地 main/renderer build 通过；不是 EXE 打包。
- 本轮修改文件 ESLint、git diff --check 通过。
- 新测试覆盖真实 organizer 分块循环六次预算、服务重建、自动跳过、手动重置；通用汇总预算、旧 failed、请求前 abort；IPC 引用和 word 时间变化；调度一万次内存累计且不改变 decision；ASR 请求前/中/后取消与 timeout 竞争后继续复用。
- Electron 自动化动态高度列表：2000 段首屏挂载 12 行，滚动到后段正确切换，seek/空列表/两行列表通过。入口 `tests/electron-transcript-virtualization.cjs`，无需人工肉眼验收。

关键文件：organization-retry.ts、ai-voice-memory-service.ts、ai.types.ts、resource-scheduler.ts、ai-model-manager.ts、VoiceMemoryDetail.tsx、TranscriptParagraphList.tsx、voiceMemoryReferences.ts、SchedulerDiagnosticsCard.tsx，以及相关测试与原样式选择器。

此前 ASR 矩阵仍由已有进程独立运行。此次 organization 修改导致整文件校验摘要变化，不应在重启矩阵时无审查地绕过指纹保护；当前进程使用原加载代码，未改其识别参数。
