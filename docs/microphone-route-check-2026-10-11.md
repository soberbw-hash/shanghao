# 麦克风输入链路检查 · 2026-10-11

## 用户反馈与当前结果

用户反馈微信和英雄联盟不能使用麦克风，但 RØDE Connect 麦克风电平仍会动。此前还有切换输入不能解决、拔插麦克风或重启才恢复的情况。本次用户明确选择一次 `Stream Input (RØDE Connect)` 后确认恢复，并补充目前正常、以前切换经常无效。

一次恢复不能证明历次故障根因相同。当前健康状态也不能代替对历史卡住状态的测量。

## 本次只读测量

### 15:40 正式版再次无法进房

正式 3.4.5 在 07:40:20、07:40:22、07:40:44 UTC 三次加入都于麦克风初始化返回 `Device in use`，没有开始新的信令连接。保存的输入选择为系统默认，Windows 三种默认输入角色仍是 Stream Input。故障时再次共享采集：Stream Input 收到 399 包／191520 帧，均有非静音数据，峰值约 0.206；实体输入仍返回 0x8889000A。当前证据区分为“虚拟输入有信号，上号采集失败”，尚未确定 Chromium 的实际默认绑定或占用者。

进房捕获错误此前先转换成可读的麦克风提示，之后被私人房间通用转换遮成“无法完成房间操作”。本地使用带原始 cause 的 MicrophoneAcquisitionError 保留权限、缺设备、占用、约束和手机输入分类；未知采集／DSP 细节只进入诊断，不暴露在 Toast。3 项定向检查及相关采集归属检查通过，没有改变 WebRTC 或绕过麦克风加入门禁。登录后枚举到设备的入口改称“声音设备”，避免未经采集验证就宣称“声音正常”。

### 16:21–16:35 明确输入、隔离对照与重开

用户手动打开上号后，通过正式界面明确选择 `Stream Input (RØDE Connect)`，16:21 保存输入选择。16:23 再次加入仍返回 `Device in use`，没有打开信令连接，因此这次故障不能仅用重选输入解释。故障时 WASAPI 共享采集仍收到 398 包／191040 帧，均有非静音数据；实体 NT-USB+ 仍返回 0x8889000A。

使用相同 Electron 42.11.8 的隐藏、隔离进程读取同一个 Stream Input。最小约束、关闭浏览器处理、实际应用 `createAudioConstraints` 三组均成功取得输入并测到非零信号；实际约束为 48 kHz／单声道，AEC 与 AGC 开启、浏览器降噪关闭。各次探针结束后停止 Track、关闭 AudioContext，没有保存声音。探针入口为忽略目录 `test-artifacts/electron-real-input-probe.cjs`。

沿用用户已给出的重启授权，在正式版空闲大厅正常关闭上号，再启动同一个正式 3.4.5 EXE；未强杀进程、改驱动或替换资源。16:34:52 成功获取本地麦克风、收到 `join_ack` 与房间快照；16:34:53 记录 `audio_worklet_started`、`mic_started`，界面显示频道已连接、1/5 在线。随后用户确认“说话是没问题了”；当时仅一人在房内，独立对端听到仍未验证。此对照支持当前上号进程的采集状态／绑定异常，但尚未定位具体触发点；不能据此证明驱动或全部历史故障没有问题。

- Windows Audio 与 AudioEndpointBuilder 服务运行；NT-USB+ 与 Stream Input 设备状态均为 OK。
- 桌面程序麦克风权限为 Allow，微信条目也为 Allow。本次没有修改权限、设备默认值、音量、独占策略或驱动。
- Windows 默认输入的 Console、Multimedia、Communications 三种角色均指向 Stream Input。英雄联盟持久设置为 `Default System Device`；没有直接编辑游戏设置文件。
- 以 WASAPI 共享模式读取输入，不保存声音。Stream Input 在约 5 秒内收到 499 包／239520 帧，非静音帧 239520，信号峰值约 0.241，未静音、音量 1.0，48 kHz／双声道／32 bit。
- 实体 NT-USB+ 的共享模式初始化返回 `0x8889000A`（设备占用），没有取得数据包。RØDE Connect 仍运行，测量时没有上号进程。由此可确认占用并不依赖上号继续运行，但没有定位占用者或证明是驱动死锁。[Microsoft IAudioClient Initialize](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize)
- 最近四小时的有限 System 日志查询没有命中 RØDE／USB 音频错误；这不能排除未记录的 USB 重连、专用驱动异常或更早的故障。

本地探针位于忽略目录 `test-artifacts/capture-endpoint-probe.cs`，只在内存中计算信号幅度，finally 停止并释放客户端，初始化采用共享模式；没有安装探针、注册服务或创建音频文件。

## 判断与建议

此前微信／游戏重新绑定后恢复；本次上号明确输入后仍失败，正常重开后才恢复。两次结果应分别记录：Stream Input 在测量时有信号，应用重新绑定或重建进程能恢复部分故障，但尚不能用它解释所有历史占用。不要将其他程序的成功采集当作上号当前进程必然可用，也不要因一次重启成功就添加自动重启或全房重连。

使用 RØDE Connect 时，可在语音应用中明确选择 Stream Input，避免直接竞争实体设备；RØDE 官方将该设备列为 Windows 接收 Connect 混音的输入入口。[RØDE Connect](https://rode.com/en/software/software/rodeconnect)

下次故障优先在故障仍存在时测量：

1. RØDE 电平有动，但 Stream Input 没有包／没有信号：重点查 RØDE 到 Windows 虚拟输入的链路。
2. Stream Input 信号正常，但应用没有声音：查应用输入绑定、静音、门限及其采集流。
3. RØDE 自身电平也不动：查硬件静音、USB 连接与驱动。拔插恢复只证明重新初始化有效，不证明是哪一个应用造成。

不自动重启音频服务、强杀 RØDE 或周期性重置驱动。上号减少重复采集和输入切换资源归属的本地修复仍按 [软件自查](software-self-audit-2026-10-11.md) 验证；它尚未进入已安装的 3.4.5，不能保证修复其他程序或驱动故障。
