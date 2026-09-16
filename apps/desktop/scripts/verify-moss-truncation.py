"""Isolated failed-source reproduction; never treats partial output as success."""
import argparse
import dataclasses
import json
import os
import subprocess
import time
import wave
from array import array
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--model', required=True)
p.add_argument('--audio', required=True)
p.add_argument('--ffmpeg', required=True)
p.add_argument('--output', required=True)
p.add_argument('--backend', choices=['auto', 'cpu'], default='auto')
a = p.parse_args()
out = Path(a.output)
out.mkdir(parents=True, exist_ok=False)
wav = out / 'source.wav'
subprocess.run([a.ffmpeg, '-nostdin', '-v', 'error', '-i', a.audio,
                '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)],
               check=True, timeout=60)
with wave.open(str(wav), 'rb') as source:
    pcm = array('h', source.readframes(source.getnframes()))
audio = array('f', (v / 32768.0 for v in pcm))
os.environ.setdefault('TRANSCRIBE_NATIVE_PROVIDER', 'cu12')
import transcribe_cpp

started = time.perf_counter()
model = transcribe_cpp.Model(a.model, backend=a.backend)
session = model.session(n_threads=4)
metadata = {'source': a.audio, 'requestedBackend': a.backend, 'samples': len(audio), 'sampleRate': 16000,
            'loadSeconds': time.perf_counter()-started,
            'limits': dataclasses.asdict(session.limits)}
print(json.dumps({'event': 'loaded', 'samples': len(audio)}, ensure_ascii=False), flush=True)
try:
    started = time.perf_counter()
    try:
        result = session.run(audio, language='zh', timestamps='segment', diarize='on')
        metadata['status'] = 'returned_output'
    except Exception as error:
        metadata.update(status='failed', errorType=type(error).__name__, error=str(error))
        result = getattr(error, 'partial_result', None)
    metadata['inferenceSeconds'] = time.perf_counter()-started
    if result is not None:
        # Private local experiment artifact; stdout contains counts, never utterances.
        (out / 'output.json').write_text(json.dumps(dataclasses.asdict(result),
                ensure_ascii=False, default=str), encoding='utf-8')
        metadata.update(textCharacters=len(result.text or ''), tokens=len(result.tokens),
                        segments=len(result.segments))
    (out / 'metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps({k:v for k,v in metadata.items() if k not in ('source','limits')}), flush=True)
finally:
    session.close()
    model.close()
