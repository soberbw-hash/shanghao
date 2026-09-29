"""Compare Qwen3 ASR decoding settings on one WAV in an isolated directory."""

import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path

import torch
from qwen_asr import Qwen3ASRModel


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
    model = Qwen3ASRModel.from_pretrained(
        str(args.model), dtype=torch.bfloat16, device_map="cuda:0",
        max_inference_batch_size=1, max_new_tokens=512,
    )
    variants = (
        ("current_chinese_512", "Chinese", 512),
        ("official_auto_512", None, 512),
        ("official_auto_256", None, 256),
        ("current_chinese_256", "Chinese", 256),
    )
    results = []
    for name, language, token_limit in variants:
        model.max_new_tokens = token_limit
        started = time.perf_counter()
        generated = model.transcribe(audio=str(args.audio), language=language)
        item = generated[0] if isinstance(generated, list) and generated else generated
        text = str(getattr(item, "text", "") or "").strip()
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
