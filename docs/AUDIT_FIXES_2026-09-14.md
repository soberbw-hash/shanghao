# 本地审计修复与云端默认模型更新

本轮不打包、不发布、不部署服务器，不修改用户数据或模型推理参数。

## 已修改

- 快捷消息 IPC 与前端统一为 5 个语音 + 3 个音乐槽位，修复最后一个音乐快捷键被拒绝；非空快捷键注册失败给出提示。
- AI 模型卡片区分默认选择与真正就绪，未安装的 FreeToken 模型不显示运行时故障状态。
- 输入/输出设备以及部分设置开关补充可访问名称。
- 空录音库大小显示 0 B，不再显示 0.1 MB。
- 清理两项已删除 ASR 模型留下的过时测试断言，不更改剩余模型行为。
- 云端服务默认 API 型号、部署模板及自定义 API 的空值回退改为 `deepseek-flash`。官方 2026-09-10 公告将其对应到 DeepSeek V4.1 Flash：https://deepseek.com/news/deepseek-v4-1-flash/ 。显式配置与环境变量优先级保持不变。

## 验证

- workspace typecheck：通过。
- desktop lint：通过。
- desktop test:smoke：最终 560/560 通过（含新增快捷键和音轨交接故障回归）。
- 云端请求测试覆盖普通/联网问答两条路由、默认型号与显式覆盖，不发送真实付费 API 请求。
- 隔离 Electron 开发版：AI 页显示 9 个 ASR 模型，默认但未安装的模型标记为“默认 · 未安装”；未安装 FreeToken 卡片无错误提示。
- 隔离录音库：空库显示 0 B。
- Electron 可访问树：输入/输出设备名称正确，自动录音按钮具有明确名称。Switch 实现为带 aria-pressed 的 button，测试按实际语义检查。

隔离开发版使用临时访客状态，没有验证真实登录、房间媒体、模型实际推理、付费云端调用或游戏负载。以上不是全局审计全部完成的声明。

## 部署边界

当前只更新本地源码。已运行的远端服务不会因本地修改而自动更新；既有 DEEPSEEK_MODEL 显式配置也不会被代码覆盖。没有操作线上服务器、发布版本或修改用户自定义 API 模型。

## 续轮实际完成

| 问题                                           | 实际修复                                                                               | 关键文件                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 更换快捷键失败会丢失原绑定                     | 新绑定注册成功后才释放原绑定；静音快捷键失败时回退原设置，无关保存不重新注册           | `shortcuts.ts`、`ipc.ts`、`settingsStore.ts`                   |
| 重复初始化可能累积更新监听                     | 重新订阅前取消旧订阅                                                                   | `settingsStore.ts`                                             |
| 模型长标题被省略、下载按钮抢视觉重点           | 标题可换行、网格按 500px 基础宽度自适应；下载采用次级按钮，未增加卡片固定留白          | `176-ai-model-management.css`、`AiVoiceMemorySettingsCard.tsx` |
| 隐藏但预热挂载的设备菜单仍可键盘聚焦           | 关闭状态增加 inert，保留预热和动画                                                     | `AudioControlPopover.tsx`                                      |
| 损坏图片一直等待、关闭动画清理不完整           | 图片失败明确提示；下一张正常图片可恢复；卸载时清理相关动画                             | `ChatImageLightbox.tsx`                                        |
| 麦克风尚未接入就提前销毁旧麦克风               | 接入成功后才提交；连续请求串行；切房后不提交旧请求；失败清理候选资源                   | `useRoomState.ts`                                              |
| 部分发送目标换轨失败，导致状态与实际音轨不一致 | 等待所有目标完成后判断；失败时恢复旧轨；恢复不完整记诊断，不能承诺失效 peer 一定能恢复 | `replaceOutgoingAudioTrack.ts`、`roomClient.ts`                |
| 系统声音混音提前销毁旧图                       | 混音交接成功后再释放旧图；失败清理候选图；销毁期间未完成的交接不能重新持有资源         | `ScreenAudioMixer.ts`                                          |
| 根 lint 扫到下载的第三方 Python 运行库内 JS    | 排除生成的 output 和 Playwright 证据目录，仍检查源代码                                 | `eslint.config.mjs`                                            |

音轨修复仅调整资源交接顺序和失败处理，没有修改 AEC、DeepFilter、音量系数或编码参数。复杂回滚放在独立音频 helper；RoomClient 行数门槛经本次局部审查从 1700 调到 1708，实际 1705 行，不以挤压代码代替可读性。没有更改 ASR 评测判定。

按 React 检查清单复核了监听去重、隐藏状态可访问性与动画生命周期；没有替换现有状态管理或动画系统。

## 续轮验证结果与边界

- `corepack pnpm typecheck`：通过。
- `corepack pnpm exec eslint . --max-warnings=0`：通过。
- `corepack pnpm --dir apps/desktop test:smoke`：560/560 通过。
- `corepack pnpm build`：通过；音频 helper 拆分后又通过 renderer build。仅编译，未打包安装程序。
- `cargo test --manifest-path native/Cargo.toml --workspace --locked`：2 项通过。
- `test:five-peer-audio`：本地五客户端定向音频备用传输测试通过。
- `test:five-peer-media`：Electron/WebRTC 合成音频 20/20 定向链路、后加入成员与断线恢复通过；最后音轨修复后已重跑。
- `test:audio-worklet`：48kHz、2.667ms render quantum、overruns=0。计时器显示的 0ms 不等于处理零成本。
- `electron-model-panel.cjs`：清除、选择、开始、失败、继续流程通过（模拟模型后端，不是真实模型推理）。
- `electron-transcript-virtualization.cjs`：2000 段场景初始 12 行、滚动后 14 行 DOM，跳转、键盘和空状态通过；不更改阅读合并规则。
- Electron AI 页面在 1120、1680、1920 宽度实测无横向溢出、无模型标题截断。截图：`output/playwright/audit-finish-20260914/ai-cards.png`。
- Playwright 实际组件夹具验证：隐藏菜单无法聚焦、打开后可操作、设备选项位置稳定、损坏图片提示、随后正常图片恢复、关闭退出。
- 故障注入测试运行实际音轨方法，验证成员/备用传输失败回退、成功后释放旧轨、混音交接失败与异步销毁清理。它不等于物理设备热插拔测试。

`corepack pnpm lint` 的 ESLint 阶段通过，但末尾 format:check 仍报告两份历史报告格式：`docs/ASR_BENCHMARK_ROUND_2026-09-05.md` 和 `docs/asr-review-2026-09-09/RECOMMENDATIONS.md`。遵照历史证据不改写原则保留原样；不能把根 lint 整体写成通过。其他发现的九处源码/测试格式问题只做了 Prettier 格式化。

## 仍不能标记完成的历史事项

- 电话模式：本次核对没有找到已落地实现，未交付。不能把当前麦克风开关等同于系统级电话模式。
- 真实五副耳机、公网、游戏同时运行、物理设备热插拔与两小时长稳验证：本轮没有完成。
- ASR 全模型长录音与 FreeToken 实机全程整理：本轮未重新启动；不能用模型面板模拟测试冒充转录完成或模型推理可用。
- DeepSeek 云端真实调用和线上默认模型生效：没有使用付费凭据调用，也没有部署远端，仅本地默认配置和请求测试完成。

本报告说明本轮补丁与实测范围，不声称全部历史任务或全局审计已经完成。
