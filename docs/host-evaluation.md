# ShangHao 3.0 Host 与 macOS 评估门槛

## 当前决定

3.0 继续使用 Electron Host。现有 React UI、WebRTC Mesh、DeepFilter、屏幕分享、托盘、
更新和 Deep Link 都已经在 Electron 路径上工作；Rust Core 只补充原生能力。不能仅因
Tauri 安装包更小就承担实时媒体和屏幕捕获回归风险。

Tauri 是 Host 替换实验，不是第二套上号。只有在同一台设备、同一 UI、同一动效、
同一语音和同一屏幕分享场景下全面胜出，才进入生产候选。目前没有这样的 A/B 数据，
因此不会创建一个不能公平运行产品链路的空 Tauri 壳来冒充完成。

## 可比指标

- 冷启动、热启动；CPU P50/P95；RAM P50/P95；GPU/VRAM。
- 实测 FPS、1% low、P95/P99 帧时间。
- 五人语音、后加入、ICE/TURN/Relay 恢复、DeepFilter 和双讲。
- 1080p 屏幕分享、系统音频、独立观看窗口和长会话。
- VibeVoice、Qwen、安装包、更新交接和视觉一致性。

Electron 侧已提供 `host-benchmark.ts` 的统一样本与汇总结构。未来 Tauri Host 必须输出
相同 schema，不能使用不同采样窗口或只比较安装包大小。

## macOS 支持门槛

架构已通过 `PlatformService` 区分 macOS 能力，但当前没有 macOS 真机，所以明确为
“未验证”，不是“已支持”。进入支持状态前必须逐项完成：

1. ScreenCaptureKit 画面采集与权限恢复；系统音频能力单独声明，不能假装 loopback。
2. 麦克风、WebRTC、DeepFilter、录音、VibeVoice、Qwen 的真机运行与资源压力验证。
3. Tray、字体、模糊、动画、多显示器、睡眠唤醒与系统权限验证。
4. Apple Silicon 与至少一个受支持 macOS 版本上的签名、公证、升级和卸载验证。

在这些证据齐全前，Windows 仍是唯一正式支持平台。
