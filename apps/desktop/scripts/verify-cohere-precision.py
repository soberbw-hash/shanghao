"""Isolated short-clip precision experiment. Never changes product defaults or old results."""
import argparse
import json
import subprocess
import time
import wave
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--audio', required=True)
parser.add_argument('--ffmpeg', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--dtype', choices=['bfloat16', 'float32'], required=True)
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
result_path = out / f'{args.dtype}.json'
if result_path.exists():
    raise RuntimeError('experiment_result_already_exists')
wav = out / 'source-first-30s.wav'
if not wav.exists():
    subprocess.run([args.ffmpeg, '-nostdin', '-v', 'error', '-i', args.audio,
                    '-t', '30', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)],
                   check=True, timeout=60)
import numpy as np
import torch
import transformers
from transformers import AutoProcessor, CohereAsrForConditionalGeneration
result = {'dtype': args.dtype, 'transformers': transformers.__version__, 'torch': torch.__version__,
          'sourceStartMs': 0, 'sourceEndMs': 30000, 'maxNewTokens': 512, 'device': 'cuda:0'}
started = time.perf_counter()
try:
    with wave.open(str(wav), 'rb') as stream:
        audio = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32) / 32768
    dtype = getattr(torch, args.dtype)
    processor = AutoProcessor.from_pretrained(args.model, local_files_only=True)
    model = CohereAsrForConditionalGeneration.from_pretrained(
        args.model, local_files_only=True, dtype=dtype, device_map='cuda:0').eval()
    result['loadSeconds'] = time.perf_counter() - started
    inputs = processor(audio, sampling_rate=16000, return_tensors='pt', language='zh', punctuation=True)
    chunk_index = inputs.get('audio_chunk_index')
    inputs = inputs.to('cuda:0', dtype=dtype)
    infer = time.perf_counter()
    with torch.inference_mode():
        outputs = model.generate(**inputs, max_new_tokens=512, do_sample=False)
    torch.cuda.synchronize()
    result['inferenceSeconds'] = time.perf_counter() - infer
    text = processor.decode(outputs, skip_special_tokens=True, audio_chunk_index=chunk_index, language='zh')
    result['text'] = text
    result['status'] = 'returned'
    result['gpuPeakAllocatedMb'] = torch.cuda.max_memory_allocated() / 1048576
except Exception as error:
    result.update(status='failed', errorType=type(error).__name__, error=str(error))
result['elapsedSeconds'] = time.perf_counter() - started
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in result.items() if k != 'text'}, ensure_ascii=True), flush=True)
