# 失败归因与追加全程验收

## 2026-09-09 用户补充要求

先修复已证实的接入问题，再评价模型；原因未确认不扣模型能力分。补测两条完整录音：

- 7d096d64-2e3b-4279-8624-21295ad5bcb0：2026-08-29 语音02，约41分钟。
- 71140c19-40da-4a72-a3df-41e3bc5276ff：2026-08-30 语音03，278.4MB，约4小时50分钟。

11模型 × 2完整音频 = 22项，追加在本次66项短/中样本之外。不要复用旧结果冒充新全程测试。不要与当前GPU任务并发运行；适配修复涉及源指纹时另建套件，不覆盖旧manifest。

## 当前已核实的失败分类，不是最终根因

旧77项的失败单元：ARK20、FireRed6、Fun32、GLM33、Paraformer2、Qwen0.6B7、Qwen1.7B3，均标记 repetition_loop；原MOSS20（异常输出15、循环5）；Cohere805（异常输出35、循环770）。

这些只能证明自动检测命中，不能证明模型能力差。须同时检查原音频是否真的重复、原始输出、采样率/音轨/截取范围、官方调用及检测器误报。若官方独立调用也出现问题，可列为该运行环境下的输出限制，但不能据一次运行认定所有硬件和场景的模型缺陷。

MOSS Q8有9个旧失败单元误标crash，已查错误正文为status18解码截断。分类已修，但解码截断仍未修复。官方Python绑定Session.run会在OutputTruncated异常附带partial_result；当前adapter未保存其部分输出。先在隔离失败原块实验中保存部分输出、token/segment数量和终止时间，判断输入/运行时限制，禁止把部分输出当成功。

Cohere先前同一30秒输入BF16/FP32对照均重复；只能排除“换FP32必能修好该输入”，不能排除依赖、输入处理或其他接入问题。不得仅凭0/7直接删模型。

## 桌面历史截图已阅读

实际发现3张相关截图：Snipaste_2026-09-01_23-14-52.png、23-15-14.png、23-15-21.png。
历史结论倾向Qwen1.7B / FireRed识别表现较好，GLM稳定，Paraformer偏极速；最后一张明确ARK运行时接入失败不代表模型能力差。

截图是历史二手汇总，缺原始版本、真值稿和完整运行日志；只作待验证线索。不把图中“41分钟预计耗时”当成已实测全程耗时，不将图中主观排名直接合入数值评分。

## 评分边界

- 适配：通过 / 接入缺陷 / 未确认，独立展示，不折算成模型识别分。
- 识别：同音频真值对照；缺真值标待评，不伪造CER或百分制总分。
- 稳定性：通过任务比例、重试/中断、已确认模型输出异常，分模式记录。
- 速度与资源：同一录音同一模式配对，列成功样本数，区别热/冷启动和实际backend。
- 去留：保留、观察、建议移除；仅给建议，不卸载，不改默认模型。

## 后续执行顺序

1. 让当前独立66项套件运行，保留所有失败。不能在其运行中修改公共runner或部署新adapter。
2. 停止后挑最少的失败原块做官方调用对照，优先MOSS截断、Cohere循环及少量Qwen/Paraformer疑似误判。
3. 证实接入或检测缺陷才做局部修复、回归；保持原识别输出和历史证据。
4. 使用确认后的单一源版本运行上述22项全程，单独目录；若仍有未归因故障则明确标注，不当作模型能力扣分。
5. 合并模式结果与历史截图线索，交付有证据的去留建议，未完成项单列。

## 2026-09-10 补测结束与原块复现

smoke 33项、standard 33项均已终态，末次完成时间2026-09-09T13:58:49Z。66项共62 success / 4 failed，不代表62项均准确率合格。两种模式源哈希均为fb03ccc2b575ace82e8311613a6e655ee08894c0a1c2a5e865f411057ba300a0。

失败：Cohere最短混音smoke/standard各1失败单元、41分钟录音standard6单元；GLM在4h50录音standard1单元。GLM该单元8914434–8917283ms，输出长串同字重复且超出合理长度，不是仅因句子分段而报错；接入根因仍待独立调用验证。

新增隔离脚本verify-moss-truncation.py，复现原MOSS Q8失败片段001313-7265540-7269029.webm。FFmpeg解码16k单声道54720样本（3.42秒），官方Session.run、auto实际Vulkan后端仍报OutputTruncated/status18，stderr明确256 token上限。加载1.374秒、推理14.668秒，部分输出7字符、17段，materialized tokens为0（不能据此否定stderr的解码token数）。部分段为空且时间相邻重叠；只确认该环境复现，不认定模型固有缺陷。私有部分输出保存在voice-memory/verification/moss-truncation-20260910-a/output.json，不进入普通诊断日志。

随后启动同权重同输入CPU隔离对照，结果目录moss-truncation-20260910-cpu；不得在其尚运行时另开模型任务。公共adapter、模型默认参数、历史结果未改。两条全程22项尚未启动，先完成这次根因对照。

CPU对照已结束：加载1.058秒、推理67.158秒，同样在256 token截断、7字符17段。确认不是只有Vulkan后端才触发，也不能简单用CPU回退修复该片段。检查无残留Python进程。下一步检查固定runtime的MOSS解码上限/停止条件及官方实现差异，不直接增大上限掩盖循环。

### 固定版本上游源码核对

### 全程验收已完成（2026-09-10T04:27:46Z）

matrix-full-followup-20260910-long 已完成22项，15 success / 7 failed。所有单元终态，全部22项外层资源释放通过，记录到的OOM/WorkerCrash均0。两条clipDurationMs分别17410070、2474350；各模型单元数分别3119、164。单一源哈希fb03ccc2b575ace82e8311613a6e655ee08894c0a1c2a5e865f411057ba300a0。不要再启动此套件，也不要在代码变化后绕过哈希续跑。

与66项合并共88项：Qwen1.7/Qwen0.6/FireRed/Paraformer/Dolphin各8/8任务成功；ARK/Fun/两种MOSS各7/8；GLM6/8；Cohere3/8。任务成功不等于准确率通过。长录音全部成功项仍多数valid_with_review。无人工真值，不生成CER或识别总分。

全程失败单元：4h50录音ARK1、Cohere3、GLM3、MOSS Q8截断2、旧MOSS5；41分钟Cohere17、Fun1。旧MOSS5个失败的rawText包含48–409个时间/说话人标记，移除标记后仅0–5字符；与Q8两处截断位置均重合。不能称为正常正文过长，也不足以确认生成循环的根因。

已局部修复旧MOSS adapter：解析正文为空不再回退到原始标记字符串；原始输出单独保存rawText。主进程现有空输出路径将其判为empty_output_on_speech，不伪装成功。scripts/test-moss-output.py执行实际adapter方法的无模型回归2/2通过；未做新的真实推理复测，原始22/66结果保持不变。本次修改改变runner源哈希，后续真实复测必须使用新独立套件。

真实原块复测已完成：使用上述3.42秒source.wav、旧MOSS固定checkpoint e8681d68e7042738ffca8ac8212bc8fcb1131ab8，通过修改后实际asr-runner worker调用；loading→ready→result，textLength=0、segments=0、rawLength=2321，进程exit0，无残留Python。这是worker协议正常退出，不是转录成功；主进程现有空正文归类路径经代码核对，本次未重跑主进程任务。首次隔离命令遗漏provider目录，报ModuleNotFoundError；补上现有asr-python-v3/moss后成功加载，属于实验启动配置错误，不计入模型成绩。未替换运行时、未改变推理参数。

待办：进一步检查Cohere等失败是否为输入/依赖/检测误判；按同模式比较速度资源并给出有边界的去留建议。当前尚无足够证据建议永久删除任何模型。后端全程不是客户端全程交互验收。

本机transcribe-cpp METADATA版本0.2.3，仓库handy-computer/transcribe.cpp。核对 https://raw.githubusercontent.com/handy-computer/transcribe.cpp/v0.2.3/src/arch/moss/model.cpp ：k_max_new=256只是生成预算下限，实际gen_budget=min(ceiling-T_prompt,max(256,2*T_enc+128))，随音频编码长度增大。停止条件包含EOS、预算、KV边界，未到EOS则返回OUTPUT_TRUNCATED。不能把此次短片段的256误解为所有长录音均固定256token，也不能靠提高n_ctx保证修复。上游源码与实测短输入截断一致，但尚未证明本机二进制与tag逐字节对应；未重编译或替换runtime。
