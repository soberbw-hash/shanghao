"""Compare Fun-ASR Nano decoding settings on one WAV in an isolated directory."""

import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path

try:
    import setuptools  # noqa: F401 - FunASR needs its distutils shim on Python 3.12+
except ModuleNotFoundError:
    pass

from funasr import AutoModel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.output.is_absolute():
        raise ValueError("absolute_output_path_required")
    output = args.output.resolve()
    protected = [Path(__file__).resolve().parents[3]]
    app_data = os.environ.get("APPDATA")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if app_data:
        protected.append(Path(app_data).resolve())
    if local_app_data:
        protected.append(Path(local_app_data).resolve() / "ShangHao" / "AI")
    if any(output == root or root in output.parents for root in protected):
        raise ValueError("output_must_be_outside_repository_and_app_data")
    model = AutoModel(
        model=str(args.model),
        trust_remote_code=True,
        device="cuda:0",
        ncpu=2,
        disable_update=True,
        disable_pbar=True,
    )
    variants = (
        ("current_chinese", {"language": "中文", "use_itn": True, "bf16": True}),
        ("official_auto", {"language": "auto", "use_itn": True, "bf16": True}),
        ("official_default", {"bf16": True}),
        ("official_fp32_default", {"bf16": False}),
    )
    results = []
    for name, settings in variants:
        started = time.perf_counter()
        generated = model.generate(
            input=str(args.audio), batch_size=1, disable_pbar=True, **settings,
        )
        item = generated[0] if isinstance(generated, list) and generated else generated
        text = str(item.get("text", item.get("raw_text", "")) if isinstance(item, dict) else item).strip()
        results.append({
            "variant": name,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
            "characters": len(text),
            "repeatedCharacter": bool(re.search(r"(.)\1{8,}", text)),
            "repeatedPhrase": bool(re.search(r"(.{2,24})\1{3,}", text)),
            "textSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "text": text,
        })
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as target:
        json.dump(results, target, ensure_ascii=False, indent=2)
    print(json.dumps([{key: value for key, value in item.items() if key != "text"} for item in results]))


if __name__ == "__main__":
    main()
