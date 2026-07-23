# 上号架构说明

上号是一款 Windows 优先的桌面端私人语音工具，目标是给 3 到 5 位固定好友提供一个稳定、低打扰、低成本的开黑语音空间。

## 核心原则

- Electron 负责原生能力：托盘、文件系统、日志、全局快捷键、系统通知、录音导出。
- React 渲染层负责 UI、房间状态、WebRTC 编排、设备切换、录音控制。
- 所有客户端只连接固定频道服务器；桌面端不再承担房主服务器职责。
- WebRTC 负责 3–5 人语音和屏幕媒体，采用小房间 mesh；媒体直传失败时，信令服务只为受影响成员提供低带宽定向兜底。
- 录音必须手动开启，最终导出目标是 AAC 编码的 `.m4a`。

## 包边界

- `apps/desktop`
  - Electron 主进程、preload、React 渲染层
- `packages/shared`
  - 枚举、领域类型、常量、IPC 契约
- `packages/signaling`
  - 房间管理和 WebSocket 信令服务
- `packages/webrtc`
  - 音频约束、Peer 生命周期、说话检测、重连辅助
- `packages/recording`
  - 录音状态机、MIME 能力检测、编码器和导出抽象
- `packages/ui`
  - 设计 token 和基础 UI 组件

## 运行流转

1. 用户打开上号。
2. 渲染层读取设置、设备和固定频道服务器状态。
3. 客户端加入固定频道 `main`，服务器确认协议与频道快照。
4. 好友通过 signaling 交换 WebRTC offer / answer / ICE。
5. 多个成员之间建立语音与屏幕媒体 mesh；晚加入者的信令按顺序处理，提前到达的 ICE 会先缓存。
6. 房间页负责成员状态、静音、PTT、设备切换和录音 UI。
7. 录音停止后，主进程接管保存、转码和导出。
