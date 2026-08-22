# ShangHao 3.0.1 性能基线与回归记录

本轮只接受真实开发运行或真实设备采样，不用估算值、截图猜测或“看起来更快”替代指标。
采样窗口默认 10 秒；长会话另记录 30 分钟和 2 小时结果。数据来自设置 → 诊断中的
真实刷新率、FPS、1% Low、P95/P99 帧时间、Long Task，以及主进程/渲染进程/系统/GPU
和 WebRTC 统计。

## 采样矩阵

| 场景                         | 刷新率 |    FPS | 1% Low | 帧时间 P95/P99 | Long Task | CPU/RAM/GPU | 结论              |
| ---------------------------- | -----: | -----: | -----: | -------------: | --------: | ----------- | ----------------- |
| Idle 空房                    | 待实测 | 待实测 | 待实测 |         待实测 |    待实测 | 待实测      | NEEDS MANUAL TEST |
| 5 人角色与天气               | 待实测 | 待实测 | 待实测 |         待实测 |    待实测 | 待实测      | NEEDS MANUAL TEST |
| 5 人语音 Mesh                | 待实测 | 待实测 | 待实测 |         待实测 |    待实测 | 待实测      | NEEDS MANUAL TEST |
| 语音光环与状态切换           | 待实测 | 待实测 | 待实测 |         待实测 |    待实测 | 待实测      | NEEDS MANUAL TEST |
| 1080p 屏幕分享               | 待实测 | 待实测 | 待实测 |         待实测 |    待实测 | 待实测      | NEEDS MANUAL TEST |
| 全组合（5 人 + 分享 + 天气） | 待实测 | 待实测 | 待实测 |         待实测 |    待实测 | 待实测      | NEEDS MANUAL TEST |

## 本轮已完成的可验证改变

- RoomPage 不再订阅屏幕帧字典；过期判断和 1 秒新鲜度时钟下沉到
  `ScreenSharePanelContainer`，因此兜底帧不会驱动整页刷新。
- RoomPage 的音频状态改为字段选择器，避免无关音频状态变化触发房间重渲染。
- 成员比较改为字段级比较，移除热路径 `JSON.stringify`，并对未变化成员保留对象引用。
- 屏幕帧序列、内容、尺寸均未变化时，store 不再创建新字典。
- Overlay 仍在状态变化时立即同步，后台 reconcile 心跳由 250ms 调整为 2s。
- 独立屏幕分享子树对分离窗口同步做 200ms 合并，避免 Relay JPEG 高频变化直接变成 IPC 风暴。
- `SceneCharacter` 使用字段/对象身份比较的 `memo`；语音光环继续通过 CSS 变量更新，不回流 React 状态。
- RoomPage 的音乐/工作活动比较改为原始字段组合，不再为检测快照分配 JSON 字符串。
- “上号”快捷语音只对该声音应用 -5 dB（线性增益约 0.5623），其它提示音不变。
- RuntimeHealth 现在单独暴露 GPU compositing、rasterization、WebGL/WebGL2、视频编解码与 ANGLE/backend 字段；D3D11 A/B 仍需目标设备实测。

## 采样注意

1. 先记录 **Before**，再记录 **Change**，最后记录 **After**；不能把 After 当成基线。
2. 诊断页显示 `--` 或没有真实房间/设备数据时，保留 `NEEDS MANUAL TEST`，不要填 0。
3. 120/144Hz、高 DPI、多显示器、RTX 4060、TURN/Relay、DeepFilter/AEC/VAD、后加入成员
   和录音/转录压力必须在目标 Windows 设备上重复采样。
4. 本轮不发布、不推送、不打包；这份记录只描述本地开发验证状态。

## 3.0.2 结构化采样新增字段

- 音频：AudioWorklet 保护路径的 `processorOverruns`、平均/峰值处理耗时、VAD/echo/double-talk 状态与原声/处理音混合比例。
- 组件：`RoomPage`、`TeamIsland`、`SceneCharacter`、`ScreenShare` 的 Render 次数及变化原因。
- Long Task：50ms 以上任务按 `js`、`canvas`、`ipc`、`image-decode`、`react`、`audio` 分类；没有真实分类时保留 `js`，不凭感觉归因。
- ScreenShare：记录 WebRTC fallback 触发时长、目标数、编码/解码/显示 FPS；relay fallback 当前目标为 250ms 单飞捕获，仍需真实设备验证触发率和清晰度。

3.0.2 的 Before/After 仍必须在同一台 RTX 4060 级 Windows 设备、同一刷新率、同一五人语音/1080p 分享组合下采样。当前不填估算 FPS、GPU、VRAM、CPU、RAM 或两小时结果。
