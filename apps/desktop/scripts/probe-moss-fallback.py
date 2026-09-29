"""Verify the source MOSS adapter against isolated WAVs, without replacing the installed runner."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--audio", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    protected = [Path(__file__).resolve().parents[3]]
    if value := os.environ.get("APPDATA"):
        protected.append(Path(value).resolve())
    if value := os.environ.get("LOCALAPPDATA"):
        protected.append(Path(value).resolve() / "ShangHao" / "AI")
    if any(output == root or root in output.parents for root in protected):
        raise ValueError("output_must_be_outside_repository_and_app_data")
    if output.exists():
        raise FileExistsError(output)

    runner = Path(__file__).with_name("asr-runner.py")
    spec = importlib.util.spec_from_file_location("shanghao_asr_probe_runner", runner)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    adapter = module.MossTranscribeDiarizeQ8(str(args.model))
    results = []
    try:
        for audio in args.audio:
            try:
                result = adapter.transcribe(str(audio), "normal")
                text = result["text"]
                results.append({
                    "audio": audio.name,
                    "status": "completed",
                    "characters": len(text),
                    "segmentCount": len(result["segments"]),
                    "fallbackParts": result["metrics"]["truncationFallbackParts"],
                    "repeatedCharacter": bool(re.search(r"([\w])\1{31,}", text)),
                    "repeatedPhrase": bool(re.search(r"(.{2,24})\1{3,}", text)),
                    "result": result,
                })
            except Exception as error:
                results.append({"audio": audio.name, "status": "failed", "error": str(error)})
    finally:
        adapter.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as target:
        json.dump(results, target, ensure_ascii=False, indent=2)
    print(json.dumps([{k: v for k, v in item.items() if k != "result"} for item in results], ensure_ascii=False))


if __name__ == "__main__":
    main()
