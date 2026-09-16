"""Isolated paired GLM input experiment; never changes product settings."""
import argparse
import json
import time
from pathlib import Path

import torch
from transformers import AutoModel, AutoProcessor

p = argparse.ArgumentParser()
p.add_argument('--model', required=True)
p.add_argument('--audio', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
target = Path(a.output)
if target.exists():
    raise RuntimeError('experiment_result_already_exists')
processor = AutoProcessor.from_pretrained(a.model, local_files_only=True)
model = AutoModel.from_pretrained(a.model, local_files_only=True,
                                dtype=torch.bfloat16, device_map='cuda:0').eval()
current = processor.apply_chat_template([{'role': 'user', 'content': [
    {'type': 'audio', 'url': a.audio},
    {'type': 'text', 'text': '请将这段音频准确转写为简体中文。'}]}],
    tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors='pt')
official = processor.apply_transcription_request(a.audio, return_tensors='pt')
comparison = {k: {'currentShape': list(v.shape), 'officialShape': list(official[k].shape),
                  'equal': torch.equal(v, official[k])}
              for k, v in current.items() if torch.is_tensor(v) and k in official}
result = {'inputComparison': comparison, 'runs': []}
for name, inputs in [('current', current), ('official', official)]:
    inputs = inputs.to('cuda:0', dtype=torch.bfloat16)
    started = time.perf_counter()
    with torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=512, do_sample=False, num_beams=1)
    torch.cuda.synchronize()
    text = processor.batch_decode(output[:, inputs.input_ids.shape[1]:],
                                  skip_special_tokens=True)[0].strip()
    row = {'input': name, 'seconds': time.perf_counter()-started,
           'characters': len(text), 'uniqueCharacters': len(set(text)), 'text': text}
    result['runs'].append(row)
    print(json.dumps({k: v for k, v in row.items() if k != 'text'}), flush=True)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(comparison), flush=True)
