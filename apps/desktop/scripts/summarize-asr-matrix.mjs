import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Read-only input audit. Writes only a separate aggregate report, never transcripts.
const [input, output] = process.argv.slice(2);
assert(input && output, 'Usage: node summarize-asr-matrix.mjs MATRIX_DIR OUTPUT_DIR');
assert(!resolve(output).startsWith(resolve(input)), 'Keep report outside matrix inputs');
const countBy = (xs) => Object.fromEntries([...new Set(xs)].sort().map(k => [k, xs.filter(v => v === k).length]));
const numeric = (x) => typeof x === 'number' && Number.isFinite(x);
const median = (xs) => {
  const a = xs.filter(numeric).sort((a,b) => a-b);
  return a.length ? (a[Math.floor((a.length-1)/2)] + a[Math.floor(a.length/2)]) / 2 : null;
};
const round = x => numeric(x) ? Math.round(x * 100) / 100 : null;
const rows = readdirSync(resolve(input, 'results')).filter(f => f.endsWith('.json')).sort().map(file => {
  const r = JSON.parse(readFileSync(resolve(input, 'results', file), 'utf8'));
  const m = r.model;
  const units = r.variant?.transcriptionUnits ?? [];
  return { file, recording: file.slice(0,36), hash:r.pipelineHash, ...m,
    taskStatus:r.taskStatus, unitCount:units.length,
    releaseConfirmed:r.release?.resourceReleaseSucceeded === true,
    wallRTF:numeric(m.totalTimeMs) && m.clipDurationMs > 0 ? m.totalTimeMs/m.clipDurationMs : null };
});
const ids = [...new Set(rows.map(r=>r.modelId))];
const recordings = [...new Set(rows.map(r=>r.recording))];
assert.equal(new Set(rows.map(r=>`${r.recording}/${r.modelId}`)).size, rows.length, 'Duplicate grain');
assert.equal(rows.length, ids.length * recordings.length, 'Incomplete matrix');
for (const r of rows) {
  assert.equal(r.unitCount, r.totalUnits, `Unit count: ${r.file}`);
  assert.equal(r.pendingUnits + r.runningUnits, 0, `Nonterminal: ${r.file}`);
}
const summaries = ids.map(id => {
  const a=rows.filter(r=>r.modelId===id), ok=a.filter(r=>r.taskStatus==='success');
  return { model:id, name:a[0].modelName, total:a.length, success:ok.length,
    rate:ok.length/a.length, clean:a.filter(r=>r.dataValidity==='valid_complete').length,
    review:a.filter(r=>r.dataValidity==='valid_with_review').length,
    failed:a.filter(r=>r.taskStatus==='failed').length,
    speedN:ok.filter(r=>numeric(r.wallRTF)).length,
    medianWallRTF:round(median(ok.map(r=>r.wallRTF))),
    gpuPeakMiB:round(Math.max(...a.map(r=>r.gpuPeakMemoryMb).filter(numeric))),
    ramPeakMiB:round(Math.max(...a.map(r=>r.ramPeakMb).filter(numeric))),
    gpuSamples:a.filter(r=>numeric(r.gpuPeakMemoryMb)).length,
    ramSamples:a.filter(r=>numeric(r.ramPeakMb)).length,
    hashes:countBy(a.map(r=>r.hash)), versions:[...new Set(a.map(r=>r.modelVersion))],
    devices:[...new Set(a.map(r=>r.device))], quantizations:[...new Set(a.map(r=>r.quantization))],
    failedUnits:a.reduce((n,r)=>n+r.failedUnits,0),
    releaseConfirmed:a.filter(r=>r.releaseConfirmed).length };
}).sort((a,b)=>b.success-a.success || a.model.localeCompare(b.model));
const audit = { generatedAt:new Date().toISOString(), input:resolve(input), grain:'recordingId x modelId',
  total:rows.length, recordings:recordings.length, models:ids.length,
  hashes:countBy(rows.map(r=>r.hash)), validity:countBy(rows.map(r=>r.dataValidity)),
  statuses:countBy(rows.map(r=>r.taskStatus)),
  missing:Object.fromEntries(['gpuPeakMemoryMb','ramPeakMb','totalTimeMs','clipDurationMs'].map(k=>[k,rows.filter(r=>!numeric(r[k])).length])),
  summaries, rows };
mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'audit.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({total:audit.total, hashes:audit.hashes, missing:audit.missing, summaries},null,2));

const source = { id:'matrix', label:'ASR matrix-pipeline-9 · 77 saved results', path:'audit.json',
  query:{description:'Per-recording model outcomes; successful-task median totalTimeMs / clipDurationMs. No transcript content.',
    language:'javascript', tables_used:['matrix-pipeline-9/results'],
    filters:['7 recordings; 11 models; terminal records; no exclusion for completion rates'],
    metric_definitions:{completion:'success records / 7; includes results needing review',wallRTF:'median(totalTimeMs/clipDurationMs) among success records only; smaller is faster'}} };
const md=(id,body,sourced=false)=>({id,type:'markdown',body,...(sourced?{sourceId:'matrix'}:{})});
const artifact={surface:'report',manifest:{version:1,surface:'report',title:'ShangHao ASR Test Review',generatedAt:audit.generatedAt,
  sources:[source],cards:[],charts:[{id:'completion',title:'成功任务数',type:'horizontalBar',dataset:'models',sourceId:'matrix',source,
    encodings:{x:{field:'name',type:'nominal'},y:{field:'success',type:'quantitative'}}}],tables:[{id:'results',title:'各模型已保存测试结果',dataset:'models',sourceId:'matrix',source,
    defaultSort:{field:'success',direction:'desc'},columns:[
      {field:'name',label:'模型'},{field:'success',label:'成功 / 7'},{field:'clean',label:'无自动复核项'},
      {field:'review',label:'成功但待复核'},{field:'failed',label:'失败'},
      {field:'medianWallRTF',label:'成功任务 RTF'},{field:'speedN',label:'速度样本数'},
      {field:'gpuPeakMiB',label:'记录峰值显存 MiB'},{field:'ramPeakMiB',label:'记录峰值 RAM MiB'}]}],blocks:[
    md('title','# ShangHao ASR Test Review'),
    md('summary','## Executive Summary\n\n- **优先试用 Dolphin，暂不宣布准确率冠军。** 本轮 7 条录音全部返回成功；仍需听审游戏词、数字和重叠说话。\n- **FireRed / Paraformer 是下一组候选。** 各成功 5/7；不能据此说它们比 Qwen 听得更准。\n- **Cohere 暂不建议作为默认。** 7/7 失败。MOSS Q8 仍有解码截断，不能说所有模型已修好。',true),
    md('basis','## 完成率用于选候选，不代替识别准确率\n\n统计单位是“录音 × 模型”，7 条录音、11 个模型，共 77 项。37 项成功、40 项失败；成功中 13 项没有自动复核标记，24 项仍待复核。没有人工参考稿，因此不提供 CER 排名。分段数与说话人数不用于加减分。\n\n下表成功任务 RTF = 总处理耗时 / 原录音时长，越小越快。只在成功记录中取中位数，不是全模型同一成功样本集合；失败多的模型存在幸存者偏差，不能单凭这一列排序。',true),
    {id:'completion-chart',type:'chart',chartId:'completion'},
    md('chart-reading','横条表示每个模型在 7 条录音中成功了几条，长度不是准确率。Dolphin 的完成性最好，但其中 6 条仍有自动复核标记，下一步必须听审。下表保留速度样本数和资源记录，便于逐项查阅。',true),
    {id:'table',type:'table',tableId:'results'},
    md('interpretation','## 分层建议比一个总榜更可信\n\n1. **稳定完成候选：Dolphin。** 7/7 成功，是当前先做实际听审的首选，而不是自动替换默认模型。\n2. **第二组：FireRed、Paraformer。** 各 5/7 成功；进一步检查失败位置及游戏词表现。\n3. **需要先解决失败：Qwen 1.7B、MOSS Q8 各 4/7；Qwen 0.6B、原 MOSS 各 3/7；ARK、Fun-ASR、GLM 各 2/7。** MOSS Q8 的长块与其他模型块长不同，不比较失败块数来判质量。\n4. **Cohere 先排查，不进入默认候选。** 0/7 成功；失败并不全是进程崩溃，重复输出也会被判异常。',true),
    md('resources','## 显存能释放，但还不能据此保证游戏不掉帧\n\n77 项外层资源释放检查全部通过。记录峰值是已有采样指标，不是模型独占物理内存证明；采样可能漏过短时峰值，原生后端与 Python 的 RAM 范围也需分别核实。不能据此声称实机游戏、耳机或客户端完整交互已经通过。',true),
    md('next','## 下一步先补质量证据，再决定默认模型\n\n- 从同一批原录音抽取安静、噪声、多人重叠、游戏词、数字和英文等片段，建立人工核对稿；同样片段对比，保留原时间轴。\n- 对 MOSS Q8 的原失败块保留部分输出及停止原因，不能把截断结果算成功。\n- 对 Cohere 优先检查重复输出根因，不通过放宽异常检测或降低输出上限掩盖失败。\n- 先验证失败块及真实客户端恢复操作，不重新盲跑全部长录音。'),
    md('questions','## 尚不能回答的问题\n\n谁听得最准、谁漏句最少、谁最擅长游戏词，目前没有足够的人工对照证据。7 条都是同一用户的本地录音，不能代表其他麦克风、语言和机器。当前报告提供可用性候选，不是最终质量排名。'),
    md('caveats','## 两组代码指纹限制严格横评\n\n65 项记录来自一组源哈希，12 项来自另一组。尚无完整源快照等价性证明，所以保留两组记录，不把它们包装为严格同版本实验。每项结果的指纹与成功条件在附带审计文件中可核对。历史失败没有删除，也没有改写成成功。',true)
  ]},snapshot:{version:1,generatedAt:audit.generatedAt,status:'ready',datasets:{models:summaries.map(({hashes,versions,devices,quantizations,...row})=>({...row,
    hashes:JSON.stringify(hashes),versions:versions.join(', '),devices:devices.join(', '),quantizations:quantizations.join(', ')}))}},sources:[source]};
writeFileSync(resolve(output,'artifact.json'),JSON.stringify(artifact,null,2));
