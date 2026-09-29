"""Compare GLM ASR decoding settings on one local WAV without touching app data.

This is a diagnostic tool. Its output may contain private transcript text, so the
caller must choose a private output path outside the repository.
"""

import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path

import torch
from transformers import AutoModel, AutoProcessor


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not args.output.is_absolute():
        raise ValueError("absolute_output_path_required")
    protected = [Path(__file__).resolve().parents[3]]
    app_data = os.environ.get("APPDATA")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if app_data:
        protected.append(Path(app_data).resolve())
    if local_app_data:
        protected.append(Path(local_app_data).resolve() / "ShangHao" / "AI")
    for root in protected:
        if output == root or root in output.parents:
            raise ValueError("output_must_be_outside_repository_and_app_data")

    processor = AutoProcessor.from_pretrained(str(args.model), local_files_only=True)
    model = AutoModel.from_pretrained(
        str(args.model),
        local_files_only=True,
        dtype=torch.bfloat16,
        device_map="cuda:0",
    )
    model.eval()
    variants = (
        ("current_zh_512", "请将这段音频准确转写为简体中文。", 512),
        ("official_en_512", "Please transcribe this audio into text", 512),
        ("official_en_128", "Please transcribe this audio into text", 128),
        ("current_zh_128", "请将这段音频准确转写为简体中文。", 128),
    )
    results = []
    for name, prompt, token_limit in variants:
        messages = [{"role": "user", "content": [
            {"type": "audio", "url": str(args.audio)},
            {"type": "text", "text": prompt},
        ]}]
        inputs = processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to("cuda:0", dtype=torch.bfloat16)
        started = time.perf_counter()
        with torch.inference_mode():
            generated_output = model.generate(
                **inputs, max_new_tokens=token_limit, do_sample=False, num_beams=1,
            )
        generated = generated_output[:, inputs.input_ids.shape[1]:]
        text = processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
        results.append({
            "variant": name,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
            "generatedTokens": int(generated.shape[1]),
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
