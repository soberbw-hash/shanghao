"""Read actual MOSS runtime limits without changing runtime or model configuration."""
import argparse
import dataclasses
import json
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
target = Path(args.output)
if target.exists():
    raise RuntimeError('experiment_result_already_exists')
os.environ.setdefault('TRANSCRIBE_NATIVE_PROVIDER', 'cu12')
import transcribe_cpp
model = transcribe_cpp.Model(args.model, backend='auto')
session = model.session(n_threads=4)
try:
    result = {'capabilities': dataclasses.asdict(model.capabilities),
              'limits': dataclasses.asdict(session.limits)}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2, default=str), encoding='utf-8')
    print(json.dumps(result, default=str), flush=True)
finally:
    session.close()
    model.close()
