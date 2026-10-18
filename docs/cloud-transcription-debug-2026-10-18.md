# 云端转录调试与修复（2026-10-18）

## 软件缺陷

录音详情的普通“开始转录”一直携带已选本地 ASR 模型 ID。主进程把这个参数当成模型对比请求，在上传前抛出 `remote_asr_model_comparison_not_supported`；错误映射又只显示通用 API 失败。实际两条失败记录处于 preprocess，尚未发出云端转录请求。

已修复：界面只在本地模式传本地模型 ID，主进程兼容旧界面残留的 ID；只有明确的 benchmark 或 `model-comparison:` 任务才被云端路径拒绝。历史失败记录无需删除，可以直接重试。

完整请求回归还发现，云端成功输出没有本地分块/VAD 统计，通用终态会把它误标为 partial_transcription。现按实际 API 成功后写入的模型与耗时、非空结果判断远端转录完成，保留本地严格的分块有效性检查；不伪造本地语音检测或覆盖率指标。转录完成状态独立于之后的整理状态。

## 真实接口核对

使用本机原加密凭据和合成的通用测试语音，未上传用户录音：

- `GET /v1/models` 返回 200，列表包含 `FunAudioLLM/SenseVoiceSmall`。
- 官方接口为 `POST https://api.siliconflow.cn/v1/audio/transcriptions`，multipart 文件与模型参数一致。
- 直连和修复后的完整 `AiVoiceMemoryService.process` 路径均实际到达 API，返回 HTTP 402 / code 30001。完整路径失败阶段为 asr，已不再被误判为本地模型对比。
- 控制台实名状态及免费模型标价已核对。账户层面的阻断需在服务商控制台处理，未执行充值、领取或提交工单；账户细节与请求追踪标识只保留在本机隔离诊断目录。
- 用户自行充值后重新实测：完整 `AiVoiceMemoryService.process` 请求返回 HTTP 200，记录 phase 为 ready，storage 阶段，生成 1 条非空转录。使用同一段合成测试语音，没有上传或修改用户录音。此前账户限制已不再阻断这次调用。

官方资料：[语音转录接口](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)、[免费模型与速率说明](https://docs.siliconflow.cn/docs/userguide/faqs/rate-limit-and-upgradation)。免费模型的费用与账户当前是否允许调用分别核对，不能仅凭模型列表或配置已保存宣称实际转录成功。

## 修改与验证

修改 `VoiceMemoryDetail.tsx`、`ai-voice-memory-service.ts`、`remote-transcription.ts`、`transcriptionProviderError.ts`；新增完整请求路由回归 `cloud-transcription-routing.test.ts` 并补充错误展示测试。

定向 8 项通过，覆盖云端/自定义模式兼容残留本地 ID、成功输出完成状态、整理阶段保留已完成转录、明确模型对比不上传、402 持久化到正确阶段及密钥/错误边界。完整 smoke 1082 项：1081 通过、0 失败、1 Windows 平台限制跳过。TypeScript、Lint、生产构建、架构预算与差异检查通过。

本轮修复保留在本地开发源码，未修改版本号、生成安装包或替换公开 v3.4.9；充值后的真实服务成功转录已经验收。
