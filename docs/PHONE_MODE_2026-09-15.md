# 电话模式：本地实现与验证（2026-09-15）

## 使用入口

- 房间底部「电话模式」，再次点击「结束电话」。
- 设置 → 语音 → 电话模式：自定义快捷键，支持「按住生效」「按键切换」。默认快捷键为空，避免抢占原有快捷键。
- 修改涉及主进程和原生助手，已打开的旧开发进程需要重新启动：仓库根目录运行 `corepack pnpm dev`。

## 实现

- `native/phone-mode/PhoneAudio.cs`：Windows Core Audio SetMute，只改变静音标志，不改音量、不禁用设备、不处理音频采样。系统默认端点和选中端点按真实设备 ID 去重；非默认设备名称必须唯一匹配，不猜设备。
- `scripts/build-phone-audio.mjs`：用 Windows 自带 .NET Framework 编译独立助手，接入 dev/build:main；不要求用户另装运行工具。助手生成到已有 native resources 路径。
- `phone-mode-service.ts`：受信任主窗口的显式 IPC、串行命令、错误反馈、锁屏/休眠/页面崩溃恢复、助手退出后单次恢复尝试。
- `phone-shortcut.ts` / `shortcuts.ts`：复用 uiohook，不轮询键盘；忽略按键重复，修饰键先松开也能结束长按。
- 音频 store 临时保存原静音/关闭扬声器状态，退出准确恢复。没有修改 DeepFilter、AEC、ASR、模型池或录音格式。
- 房间 presence 增加可选 `callModeActive`，本地服务支持实时同步和后加入快照；人物状态显示「通话中」。
- 静音前原子写恢复记录，助手在 stdin EOF 后恢复。用户级互斥避免两个窗口同时改系统静音；设备事件驱动，没有设备轮询。

## 已完成验证

- Windows 助手实际编译、只读启动、正常退出。
- 实际系统音频：4 个去重端点全部静音，前后音量值完全相同，退出后原静音标志完全恢复。
- 再次进入后关闭父通信管道，助手完成恢复，恢复记录为空。
- 快捷键连续 20 次按放、重复键按下、先松修饰键、toggle、reset；原 8 个快捷消息与静音/Marker 冲突回归通过。
- App 音频 store 所有原始 mic/speaker 静音组合恢复测试通过。
- 563 项桌面冒烟测试通过；桌面 ESLint 和类型检查通过。
- Electron 隔离 UI 测试：实际组件入口、开始/结束按钮切换、两种触发选项通过。该 UI 测试使用模拟 IPC；不是游戏内真实键盘测试。
- 本地三个 WebSocket 客户端验证状态广播、后加入快照、退出同步通过。
- 五端音频 20 条有向链路、后加入/重连通过；五端真实 WebRTC 媒体自动化 20 条链路与故障恢复通过。
- 桌面主进程、Renderer、电话助手构建通过；未打包 EXE/Release。

## 尚未验收 / 限制

- 未部署线上信令服务器。线上旧服务不会同步新状态字段，好友可见状态不能视为已上线。
- 未完成真实游戏中全局按键、物理拔插/切换设备、硬件锁屏/休眠及长时间多人听感验收。
- 整棵进程树被强杀或断电时无法即时执行恢复，需要下次启动读取恢复记录。设备暂时离线时保留其恢复记录。
- 共享模式下系统静音不等于能够拦截所有独占模式/绕过系统混音的驱动路径，不能承诺一切第三方音频均被拦截。
- 仓库根 `corepack pnpm build` 的 Rust Core 阶段因本机缺少 Visual C++ `link.exe` 失败。没有绕过该检查或伪称全量构建通过；桌面构建和电话助手构建单独通过。
- 旧历史 ASR/FreeToken 全量长录音任务没有在本轮重新执行，本记录不代表全部历史需求均已验收。

## 可复跑

`node scripts/verify-phone-audio.mjs` 会短暂静音真实系统，只应在适合测试时手动运行。

`node scripts/verify-phone-presence.mjs` 只使用本机临时信令服务（需先构建 shared/signaling）。

`corepack pnpm --dir apps/desktop exec electron tests/electron-phone-mode.cjs` 使用隔离组件，不修改用户设置、不进入线上房间。
