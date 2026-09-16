# ASR Benchmark 本地验证记录（进行中）

本轮基于本地 3.0.8。没有发布、打包安装包或更换模型权重。当前测试流水线版本为 9。

## 已实现

- 11 个模型按“高精度转录 / 极速转录”展示，类别不参与质量打分。
- `emptyOutputOnSpeechUnits` 是复查信号；长于 2 秒且有足够活动人声证据的空输出额外标记 `suspectedOmissionCount`，不直接判循环、乱码或幻觉。
- 重复循环 / 异常解码才影响异常有效性；不再用异常解码计数冒充幻觉计数。
- 质量、速度、稳定性资格分别判断；跨模型文字长短只能生成复查候选。不同流水线版本不能混入同一排名。
- Benchmark 单元最多自动重试一次；逐次记录输出、失败、耗时和异常，首次失败不会被成功重试覆盖。正常转录的既有最大重试策略保持原状。
- Qwen 保留原本官方 `transcribe` 调用，对其中的 ForcedAligner `align` 调用单独计时。分阶段加载模式明确在原始指标记录 `alignmentIncludesModelSwap`。
- Fun-ASR 分别记录 provider import 和模型初始化；首次加载指标不会在每个热单元重复累加。
- 资源检测等待真实 Worker 退出，然后等待显存回收再测量；退出超时不允许冒充已退出，新模型不能与未退出的旧 Worker 重叠。
- 汇总包含音频转换、VAD、加载、ASR、对齐、后处理、保存、释放、未归因耗时，以及基于录音墙钟时长的 `clipWallSpeedX`。
- Python Worker 报告 Windows 峰值工作集和进程 CPU 统计。该 RAM 指标不包含独立 native 子进程，也不代表全系统 RAM 峰值。

## 已完成验证

- 类型检查通过。
- 536 项桌面回归测试通过。
- 本地主进程、Renderer 构建通过；并非 Release 打包。
- 11 个已安装模型的运行环境预检通过。

GLM 旧失败单元已使用原始说话人音频复现两次：

- 录音：2026-08-30 16:24 的语音 03，ID `71140c19-40da-4a72-a3df-41e3bc5276ff`。
- 原录音时间：8,914,434–8,917,283 ms（2:28:34.434–2:28:37.283）。
- 两次均为 `repetition_loop`；首次加载 31.205 秒，推理分别约 28.492 / 15.353 秒。
- 未更改 GLM 生成参数。原始输出保留在本地 `glm-reproduction.json`，该证据支持当前配置下真实可重复的解码循环，不能据此归因于硬件不足。

首条录音（2026-08-23 13:19，329.81 秒）的阶段数据：

| 模型                      |    总耗时 |     加载 |        ASR |    对齐 | clipWallSpeedX | 显存基线 / 峰值 / 释放后 |
| ------------------------- | --------: | -------: | ---------: | ------: | -------------: | -----------------------: |
| Qwen 1.7B + ForcedAligner |  83.58 秒 | 36.46 秒 |   37.80 秒 | 1.14 秒 |         3.946× |      938 / 7195 / 920 MB |
| Fun-ASR-Nano              | 117.30 秒 | 76.21 秒 | 见原始报告 |  不适用 |         2.812× |               见原始报告 |

Fun-ASR 首次加载的 76.21 秒由约 27.36 秒 provider import、46.53 秒模型初始化和 2.31 秒 Worker 启动组成。现有初始化设置 `disable_update=True`，这轮未重复加载每个单元。具体初始化子调用和磁盘/模块导入瓶颈仍需继续采样，不能宣称全部属于必需开销。

## 全量测试与后续检查

运行器：`apps/desktop/scripts/verify-asr-matrix.ts`。

```powershell
corepack pnpm --dir apps/desktop exec node --import tsx scripts/verify-asr-matrix.ts --preflight
corepack pnpm --dir apps/desktop exec node --import tsx scripts/verify-asr-matrix.ts --reproduce-glm
corepack pnpm --dir apps/desktop exec node --import tsx scripts/verify-asr-matrix.ts --run
```

全量矩阵：7 条现有语音库记录 × 11 模型，共 77 个完整任务。运行器使用正式主进程服务、原音频和身份音轨，但用独立记录/模型状态目录，不覆盖日常语音库与用户默认模型。它不会在当前安装版前端卡片中显示实时进度；因此也不能把这轮脚本测试称为完成了安装版前端端到端验证。

结果目录：`C:\Users\sober\AppData\Roaming\shanghao-desktop\voice-memory\verification\matrix-pipeline-9`。

- `current.json`：当前模型与录音、运行器 PID。
- `manifest.json`：输入清单、版本与代码指纹。早期记录曾称格式化等价指纹保存在 `equivalentFormattingHashes`；2026-09-08 实际核查当前 manifest 已没有该字段，因此不能依赖该说法证明两组结果等价。原始逐结果指纹保留，详见末尾审计。
- `voice-memory/records`：单元级进度与断点。
- `results`：逐模型原始结果和摘要。
- `summaries`：逐录音跨模型分析。
- `glm-reproduction.json`：GLM 原失败片段两次复现证据。

当前不能宣称 77 个任务全部完成。需继续核对每条录音的 11 个结果、OOM/崩溃/重试、时间归因、资源释放及总结导出。没有人工 Ground Truth 的录音不提供 CER 或客观准确率。

GPU 采样为设备总显存，包括桌面/其他进程；`gpuMemoryAfterLoadMb` 兼容字段目前采于首次推理返回后，不能作为严格的“加载完成瞬间”显存。Windows Worker 峰值 RAM 不包含全部 native 子进程。以上范围应在读取测试数据时一并考虑。

## 2026-09-07 恢复检查

- 已保存 65/77 份逐模型结果，不代表全部有效：其中包含真实输出异常，以及 MOSS Q8 的运行错误，仍待逐项审核。
- 旧 PID 21128 已不存在，状态文件停在 482b84c7 录音的 ARK，不能推断进程退出原因。
- 发现测试脚本用仅在完成阶段写入的顶层 pipelineVersion 判断断点，导致恢复时重新开始当前模型。已改为同时验证持久化单元的 modelId/pipelineVersion，未修改识别流水线。
- 本次首次恢复使 ARK 原 134 个完成单元重新开始，这部分测试需要重跑；65 份已完成结果未受影响。随后再次恢复已验证从 7 个完成单元继续至 12 个，没有再归零。
- 全量测试已重新运行，另设置每 15 分钟跟进实际进程和结果；当前仍非最终验收完成。

## 2026-09-08 全量运行结束后的初步审计

运行于 2026-09-07 23:48:08（北京时间）结束，7 条录音 × 11 个模型的 77 份结果及 7 份汇总均已保存。runner 28540 已退出；检查未发现遗留 Python 子进程。没有重新启动全量测试。

- taskStatus：37 success，40 failed。
- dataValidity：13 valid_complete、24 valid_with_review、37 invalid_output_anomaly、3 invalid_runtime_error。success 不等于无待复核片段，更不能当作准确率合格。
- Dolphin 7/7 success；Cohere 7/7 failed，累计 805 个失败单元，需要复核重复输出及异常检测，不据此编造 CER。
- 77 份外层 release.resourceReleaseSucceeded 均为 true；汇总 oomCount、workerCrashCount 均为 0。这仅说明已记录指标，不能证明客户端交互无错误。
- MOSS Q8 的 3 份 invalid_runtime_error 共 9 个失败单元，真实错误均为 `output truncated: decode hit the context/generation cap before end-of-stream (status 18)`。单元 errorCode 被标为 crash，但这不是已有证据支持的进程崩溃或 OOM：实际是运行时报告解码截断。需单独检查错误分类，不改变模型参数、不将截断算成功。

尚未完成：异常检测误判审核、截断错误分类修复及最小回归、各录音计划范围/单元完整性与历史 pipelineHash 兼容性核对、真实客户端端到端验证。保留全部原始失败，不清除、不覆盖历史结果。本节不是最终全部通过报告。

### 解码截断分类修复

`local-model-runtime.ts` 现将明确的 `output truncated` / `output_truncated` / 解码上下文上限消息分类为 `output_truncated`，不再落入默认 `crash`。仍判为失败，不修改模型参数、重试次数或历史结果。两项分类回归及 desktop typecheck 通过；这解决诊断误标，不代表解码截断本身已解决。上述剩余清单中的分类修复及最小回归已完成，其他项仍待核查。

### 原音轨范围抽查

对每条录音的 Dolphin 结果与现存来源清单核对 start/end 区间多重集合，7 条均无差异：混音 11/345/827/444 单元，独立参与者音轨 3044/164 单元，speech-only 3119 单元。4h50 录音的 speech manifest 在旧 `shanghao` 数据目录，3121 个片段中最后两个起点已超出混音总时长，因此计划内为 3119，不是漏掉两个任务。speech-only 的停顿间隙、参与者音轨的重叠不能按混音连续 30 秒的假设判断漏转。这是计划范围检查，不是所有模型识别内容正确的证明。

Cohere 最短录音首单元的原始输出及两次尝试均保留了明显长串重复字符，确认该样本并非仅因原生分段形式被误判；未据单个样本推断全部 805 个失败单元均为真实幻觉，也未调整检测阈值。

进一步核对全部 77 项：无 pending/running 单元；保存单元数量与报告 totalUnits 一致。73 项的 start/end/speaker 区间多重集合与各自 Dolphin 基线相同。另 4 项 MOSS Q8 混音使用已有 600 秒长块策略（1/42/23/18 单元），逐项确认从 0 覆盖到 clipDurationMs、无区间间隙；不同块数不是漏转。该检查确认计划执行到终态，不代表失败单元成功识别。

历史源哈希仍有两组：65 项 `39a047d0dd0b69febd31dd89d6eb37c211428171cf8f2cb68594d63f4c42672b`、12 项 `7dd8cf4f0c090aa78a7ef2c3f10734d31d00e5334b0e0fc37602abb1775391a2`。不修改历史哈希；在没有完成对应源快照等价性核对前，不宣称 77 项具有完全相同的源指纹。

### Cohere 失败证据完整性

805 个失败单元均保留 rawRuntimeOutput。末次输出的异常原因计数为 repeated_phrase 710、repeated_character 464、invalid_text 102、implausible_length 4；一个单元可命中多个原因，不能相加当作失败总数。这些是自动检测证据，不是人工逐段听审结果。现有 benchmark validity 与 runtime error 分类共 14 项回归通过，包含分段数量/说话人数不影响排名资格、完整保存才算完成，以及重试恢复后的异常统计。未为了减少失败数字放宽阈值。

补充最小回归：`asr-benchmark-evidence.test.ts`、`model-comparison-export.test.ts` 共 5 项通过，覆盖质量异常不抹去完整运行证据、速度分母/未归因时间、实际退出后的资源采样、原始导出数据和中断结果不得冒充完成。该验证不启动模型、不读写用户录音，不替代真实客户端点击操作验证。

2026-09-08 收尾完整回归：`corepack pnpm --dir apps/desktop test:smoke` 547/547 通过，无跳过、无失败。范围包含本轮录音缓存删除刷新和截断分类修复；仍不能替代完整客户端交互及真实逐段音频听审。

### 隔离 Electron 面板回归

新增 `tests/electron-model-panel.cjs` 与 `tests/fixtures/model-panel.{html,tsx}`，渲染真实 ModelTestPanel，点击清除测试结果→开始测试→确认模型仍在且被选中→启动→模拟失败暂停→继续→恢复运行按钮。实际执行通过（exit 0），fixture 类型检查与 lint 通过。仅在 fixture 替换 queue/API，既不调用真实模型，也不清除实际录音；不能据此声称生产队列及真实后端全链路通过。Vite 显式指向 shared 源码，避免旧 dist 缺少新导出导致测试加载失败。

### Cohere 官方调用核对（2026-09-08）

对照官方模型卡 https://huggingface.co/CohereLabs/cohere-transcribe-03-2026 的当前原生 Transformers 示例：本地 `CohereTranscribe` 使用相同的 AutoProcessor / CohereAsrForConditionalGeneration、传采样率及语言、保留 audio_chunk_index 并交给 processor.decode，基本调用结构一致。官方支持中文、默认标点开启；没有发现仅凭这一层代码足以解释所有重复输出的确定错误。

本地固定 CUDA BF16、max_new_tokens=512、do_sample=False；官方快速示例 max_new_tokens=256、未明确指定 dtype，不能据此声称两者数值行为完全相同，也不能未经对照实测就把差异认定为根因。本轮不改变这些模型参数，不以降低输出上限掩盖重复；依赖具体版本、输入特征与数值精度仍是后续最小实验候选，不是已确认缺陷。

## 2026-09-08 精度隔离对照实测

用户要求继续后，新增只用于实验的 `scripts/verify-cohere-precision.py`，读取最短录音（179cb9ad）的前 30 秒并另存测试 WAV。实验结果位于 `%APPDATA%/shanghao-desktop/voice-memory/verification/cohere-precision-20260908`，不覆盖矩阵结果、模型配置或用户录音。两次均同一 checkpoint、中文、标点开启、512 token 上限、确定性生成；无 ForcedAligner。实际依赖 Transformers 5.15.0、Torch 2.11.0+cu128。

| 实验精度 | 加载秒 | 推理秒 | Torch 峰值 allocated MiB | 输出字符数 | 长串重复 |
| -------- | -----: | -----: | -----------------------: | ---------: | -------- |
| BF16     |  3.481 |  4.014 |                 4034.724 |        252 | 存在     |
| FP32     |  4.153 | 56.839 |                 8076.823 |        256 | 存在     |

两次均返回输出但不代表质量成功。FP32 未消除该样本重复，且约慢 14 倍；不将 FP32 切为默认。Torch allocated 不是设备总显存或物理独占显存，FP32 运行中 nvidia-smi 采样设备显存 7888 MiB、GPU 99%，可能存在 WDDM 内存压力，不能仅凭数值断言具体换页量。两进程退出后设备显存采样回到 591 MiB。

另用 `scripts/verify-moss-session-limits.py` 实际加载当前 MOSS Q8 读取能力：backend 自动选择 Vulkan0（4060 Ti），native_sample_rate=16000，effective_n_ctx=131072，effective_max_audio_ms=10458400，max_kv_bytes=15032385536（上限字段不是实测占用）。因此不能仅因 10 分钟分块就断言超出声明的音频上限；status18 具体触发仍需失败原块的部分输出/解码终止证据。该脚本只读取运行时能力，没有进行 MOSS 推理，不冒充截断修复完成。
