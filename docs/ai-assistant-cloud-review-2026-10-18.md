# AI 助手、云端转录与开发版入口检查（2026-10-18）

## 本轮交付

- 聊天区右上保留透明 Bot 图标，与设置按钮分开。欢迎卡片在快捷消息面板内部展开，不另开聊天窗；标题使用 HarmonyOS 字体，不再显示自我介绍小字。
- “开始提问”从较短按钮原地展开为输入框，角色和标题位置保持稳定。关闭时保留输入框布局直至卡片收起，不再先闪回按钮。展开和未展开共用网格折叠动画，并支持减少动态效果设置。
- 模型页分为“文本整理与问答”和“语音转录”，两侧按内容决定高度，避免左侧跟随密钥表单留下大块空白。只有选择本地转录才显示本地模型库与筛选。
- 文本提供实际 GLM、DeepSeek 和自定义接口配置；本机开发版默认已保存为 GLM-4-Flash-250414。语音转录默认 SenseVoiceSmall 云端，可切换本地或兼容的自定义接口。
- SenseVoice 通过主进程请求官方 `FunAudioLLM/SenseVoiceSmall`，密钥单独加密保存，不返回给界面。云端路径不准备本地 Python/模型；历史延后任务切换到云端后也不再被本地模型就绪条件拦住。
- 云端转录返回纯文本，界面的时间轴为估算，不具备真实说话人分离。保留本地模型和转录记录，不替换已有数据。
- 快捷消息库增加间距；修复 React StrictMode 下“修改资料”首次跳错设置标签的问题。

## Bot 素材与状态

原始四张透明 PNG 保存在 `apps/desktop/src/renderer/src/assets/ai/mascot/`，另存房间参考图 `reference-room.png`。原桌面文件未修改，素材库可查看这五份资源，README 记录来源与校验信息。

- idle：默认、请求完成或取消。
- thinking：现有问答请求处理中。
- error：请求失败，显示实际错误后恢复可交互状态。
- gaming：明确的游戏助手消息触发，不因进入普通聊天自动切换。
- greeting：保留素材及状态能力；按后续要求取消欢迎卡片自动左右晃动。
- speaking：保留视觉映射，未接入不存在的 AI 语音合成功能，不制造播放状态。

入口和输入均复用现有房间问答能力，不添加假成功按钮。

## 主要修改文件

- 入口与动画：`ChatAssistantWelcome.tsx`、`ChatPanelHeader.tsx`、`AssistantBotAvatar.tsx`、`useAssistantBotState.ts`，以及样式分片 `221`—`223`；房间聊天面板与 `RoomAskDialog.tsx` 复用这些组件。
- 模型设置：`AiVoiceMemorySettingsCard.tsx`、`177-ai-model-provider-panels.css`；相关录音库、详情和模型测试面板识别云端模式。
- 转录与密钥：`ai-transcription-provider-store.ts`、`remote-transcription.ts`、`transcription-provider-ipc.ts`、`ai-provider-response.ts`、`ai-voice-memory-service.ts`、`custom-ai-provider-store.ts`，以及显式共享类型、IPC 和 preload 接口。
- 启动与图标：`development-shortcuts.ts`、`window.ts`、`index.ts`、`scripts/start-desktop-dev.mjs`、`scripts/install-desktop-dev.cjs`。
- 数据与设置兼容：`ai-storage.ts`、`settings-migration.ts`、`settingsStore.ts`、`settingsSectionState.ts`；保留并衔接本地已有共享转录库修改。
- 素材与检查：`assets/ai/mascot/`、`tools/asset-review/build.mjs`；新增转录提供商、启动快捷方式、设置导航、实际渲染动画回归测试及夹具。

以上组件位于 `apps/desktop/src/renderer/src/`，主进程文件位于 `apps/desktop/src/main/`。本轮保留了开始时工作区已有修改，具体完整列表以当前 Git 差异为准。

## 图标和启动问题

发现开始菜单中存在与开发版同一 AppUserModelID 的裸 `Electron.lnk`，桌面开发版入口也缺少稳定应用标识。旧启动服务退出后还会留下无法连接界面的 Electron 窗口。

现在桌面、开始菜单及兼容入口统一指向带官方图标的隐藏启动器，并带独立开发版 AppUserModelID。启动时校验这些入口；监听同一运行器的冲突快捷方式并修复图标和目标，避免影响其他 Electron 软件。开发服务独立运行并复用健康实例，不随启动脚本退出而停止。新增安装脚本可重建入口，旧启动文件已备份。

实际从桌面入口打开并再次点击验证，开发版正常显示、服务复用。已核对快捷方式图标、目标和应用标识；没有把任务栏缓存或真实游戏全屏验证说成已经完成。

## 配置与真实接口结果

本机密钥通过应用加密存储。备份及说明位于：

`C:\Users\sober\Desktop\重装必备资料\01_账号与密钥\上号软件凭据\SenseVoice_2026-10-18`

备份受当前 Windows 用户保护，包含加密数据及解密依赖的加密 Local State，不是可跨重装直接恢复的明文密钥。说明中记录了重装后的重新配置办法。项目、日志与本报告不包含个人密钥。

- GLM：使用本机已有授权配置，真实发送通用 JSON 测试并验证结果，成功。
- SenseVoice：使用新保存的密钥，发送本机合成的通用测试语音；官方返回 **HTTP 402 / code 30001：账户余额不足**。因此尚未取得真实转录成功结果，不能宣称完全可用。没有上传用户录音，没有充值。
- 应用已将余额不足、密钥错误、限流等响应转换为明确提示，保留重试能力。需要在硅基流动账户处理该限制后重新做真实转录验收；价格为零不等于当前账户一定允许调用。

## 验证证据

- 桌面 TypeScript、全库 ESLint、格式检查、架构护栏及预算比较通过；原有文件预算未提高。
- 最终全量 smoke 共 1071 项：1070 通过、0 失败、1 跳过，包含新增的云端延后任务回归。跳过项为 Windows 不支持的私有 pip 子进程取消用例。
- 五个共享包、桌面主进程、界面生产构建及素材库打包通过。生产输出包含四个带哈希的 Bot 图片；素材库生成 203 张预览。
- 实际 Electron 渲染动画测试：普通模式采样 46 帧，0 次闪回开始按钮，折叠单调收起至高度 0；减少动态效果模式通过；反复展开关闭及图片加载通过。该测试使用真实组件与样式，问答输入为隔离夹具，不代表云端请求成功。
- 五人信令音频回归通过；隔离环境 WebRTC 媒体测试通过 20/20 有向音频流及恢复验证。它不等于五台真实机器或所有游戏全屏/驱动组合验收。
- 实际开发版验证：桌面启动、重复启动、已保存模型默认值及密钥状态重启保留、账号设置导航通过。

本轮仅做本地开发与生产构建验证，未生成新安装包、修改版本号、推送或发布。已有用户录音、模型、转录和账号数据保留；ASO 搜索未改动。
