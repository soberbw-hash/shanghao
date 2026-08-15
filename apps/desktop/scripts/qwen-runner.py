"""Single-shot local Qwen runner. Reads a prompt from stdin and prints JSON/text."""

from __future__ import annotations

import argparse
import json
import sys

import torch
from transformers import AutoModelForImageTextToText, AutoTokenizer


sys.stdout.reconfigure(encoding="utf-8", errors="strict")
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--resource-mode", choices=("low", "normal"), default="normal")
    args = parser.parse_args()
    # Electron always writes UTF-8. On Chinese Windows, Python may otherwise decode redirected
    # stdin with the active ANSI code page and introduce surrogate characters that the tokenizer
    # rejects before inference starts.
    prompt = sys.stdin.buffer.read().decode("utf-8", errors="strict").strip()
    if not prompt:
        raise RuntimeError("empty_prompt")

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True)
    messages = [{"role": "user", "content": prompt}]
    templated = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    input_ids = tokenizer(templated, add_special_tokens=False)["input_ids"]
    if input_ids and isinstance(input_ids[0], list):
        input_ids = input_ids[0]
    inputs = {"input_ids": torch.tensor([input_ids], dtype=torch.long)}
    inputs["attention_mask"] = torch.ones_like(inputs["input_ids"])
    model = AutoModelForImageTextToText.from_pretrained(
        args.model,
        local_files_only=True,
        dtype=dtype,
        device_map="auto" if torch.cuda.is_available() else "cpu",
        low_cpu_mem_usage=True,
    )
    if args.resource_mode == "low":
        torch.set_num_threads(2)
    input_device = next((parameter.device for parameter in model.parameters() if parameter.device.type != "meta"), torch.device("cpu"))
    inputs = {key: value.to(input_device) for key, value in inputs.items()}
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            max_new_tokens=max(16, min(4096, args.max_new_tokens)),
            max_time=90,
            do_sample=False,
            repetition_penalty=1.08,
            pad_token_id=tokenizer.eos_token_id,
        )
    output = tokenizer.decode(generated[0][inputs["input_ids"].shape[-1] :], skip_special_tokens=True)
    print(output.strip())
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # keep one parseable error line for the Electron host
        print(json.dumps({"runtimeError": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
