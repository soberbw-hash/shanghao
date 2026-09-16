# GLM 输入适配核查（2026-09-10）

剩余全程异常的无正文统计：ARK 1638ms/256字符/2种字符；GLM
2202ms/1023字符/4种、2849ms/513字符/5种、3285ms/512字符/1种；
Fun 30秒/755字符/21种（VAD语音4140ms）。这些不是“分段多”导致的失败。
但不能单凭重复统计认定模型权重有问题，也不能据此放宽检测将其算成功。

发现需要实际对照的 GLM 输入差异：固定 checkpoint README 推荐
`processor.apply_transcription_request(audio)`；当前 adapter 手工构建聊天请求，
附加中文提示“请将这段音频准确转写为简体中文。”。
通过当前安装 runtime 的 inspect.getsource 核对，官方 helper 使用
`default_transcription_prompt`（文档默认 Transcribe the input speech.），
文件输入使用 path 键，而当前 adapter 使用 url。helper 仍调用同一个
apply_chat_template，不足以仅凭代码差异认定缺陷。

下一步：同一已安装模型、同一失败音频、同一 dtype/生成参数，分别比较
当前输入与官方 helper；先比较输入特征/请求，再串行生成。不要同时改变
precision、token budget、checkpoint，不修改生产 adapter 直到复现证据明确。
候选原块：speaker-segments/recordings/71140c19-40da-4a72-a3df-41e3bc5276ff/
002817-15749053-15752338.webm，需以 manifest 的 filePath 为准。

本轮未改变生产参数、模型、历史结果或评分。独立推理对照尚未执行。

## 配对实测已完成

使用 scripts/verify-glm-input.py，固定原块转16k单声道PCM16，同一加载模型
顺序执行当前请求和官方 helper。BF16 / 512 token / do_sample=False /
num_beams=1 均不变。当前请求14.546秒、官方请求13.608秒；两者均输出
512字符且只有1种字符。input_features 和 input_features_mask 逐元素相等，
仅文本 input_ids / attention_mask 长度分别58和53、内容不同。

因此对这个失败样本，文件 url/path 写法没有造成音频特征差异，改成官方
提示也没有消除循环。不应仅为此替换生产输入接口并声称修复。尚未区分
权重、运行时或该短输入的内容敏感性，不据此给 GLM 普遍准确率扣分。
进程正常退出，结果保存在私有 verification/glm-input-20260910/comparison.json，
报告不复制转录正文。没有改生产参数或覆盖原测试结果。
