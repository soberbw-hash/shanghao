"""Local Qwen runtime.

The Electron host normally starts this file in ``--worker`` mode. The model is loaded once,
requests use a UTF-8 JSON-lines protocol, and only one generation runs at a time. Single-shot
mode remains available for runtime repair diagnostics.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

import torch
from transformers import AutoModelForImageTextToText, AutoTokenizer


sys.stdout.reconfigure(encoding="utf-8", errors="strict", line_buffering=True)
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace", line_buffering=True)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def load_runtime(model_path: str) -> tuple[Any, Any]:
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForImageTextToText.from_pretrained(
        model_path,
        local_files_only=True,
        dtype=dtype,
        device_map="auto" if torch.cuda.is_available() else "cpu",
        low_cpu_mem_usage=True,
    )
    model.eval()
    return tokenizer, model


def generate(
    tokenizer: Any,
    model: Any,
    prompt: str,
    max_new_tokens: int,
    resource_mode: str,
) -> str:
    prompt = prompt.strip()
    if not prompt:
        raise RuntimeError("empty_prompt")
    torch.set_num_threads(2 if resource_mode == "low" else max(2, min(6, torch.get_num_threads())))
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
    input_device = next(
        (parameter.device for parameter in model.parameters() if parameter.device.type != "meta"),
        torch.device("cpu"),
    )
    inputs = {key: value.to(input_device) for key, value in inputs.items()}
    with torch.inference_mode():
        generated = model.generate(
            **inputs,
            max_new_tokens=max(16, min(4096, max_new_tokens)),
            # Generation runs in a separate low-priority worker. Allow a
            # structured Chinese summary enough time on GPUs that offload
            # part of Qwen3.5-4B to system memory.
            max_time=150,
            do_sample=False,
            repetition_penalty=1.08,
            pad_token_id=tokenizer.eos_token_id,
        )
    return tokenizer.decode(
        generated[0][inputs["input_ids"].shape[-1] :],
        skip_special_tokens=True,
    ).strip()


def run_worker(model_path: str) -> int:
    emit({"type": "loading"})
    tokenizer, model = load_runtime(model_path)
    emit({"type": "ready"})
    for raw_line in sys.stdin.buffer:
        request_id = ""
        try:
            request = json.loads(raw_line.decode("utf-8", errors="strict"))
            request_id = str(request.get("id", ""))
            if not request_id:
                raise RuntimeError("missing_request_id")
            output = generate(
                tokenizer,
                model,
                str(request.get("prompt", "")),
                int(request.get("maxNewTokens", 1024)),
                str(request.get("resourceMode", "normal")),
            )
            emit({"type": "result", "id": request_id, "output": output})
        except Exception as exc:  # keep the process reusable after an individual bad request
            emit({"type": "error", "id": request_id, "error": str(exc)})
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--resource-mode", choices=("low", "normal"), default="normal")
    args = parser.parse_args()
    if args.worker:
        return run_worker(args.model)

    prompt = sys.stdin.buffer.read().decode("utf-8", errors="strict")
    tokenizer, model = load_runtime(args.model)
    print(generate(tokenizer, model, prompt, args.max_new_tokens, args.resource_mode), flush=True)
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # one parseable error line for the Electron host
        print(json.dumps({"runtimeError": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
