"""Probe native MOSS truncation at several chunk sizes without touching app data."""

import argparse
from array import array
import json
import os
from pathlib import Path
import sys
import time
import wave


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    protected = [Path(__file__).resolve().parents[3]]
    for name in ("APPDATA",):
        if value := os.environ.get(name):
            protected.append(Path(value).resolve())
    if value := os.environ.get("LOCALAPPDATA"):
        protected.append(Path(value).resolve() / "ShangHao" / "AI")
    if any(output == root or root in output.parents for root in protected):
        raise ValueError("output_must_be_outside_repository_and_app_data")
    if output.exists():
        raise FileExistsError(output)

    os.environ.setdefault("TRANSCRIBE_NATIVE_PROVIDER", "cu12")
    import transcribe_cpp

    with wave.open(str(args.audio), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate()) != (1, 2, 16_000):
            raise ValueError("expected_mono_pcm16_16khz")
        samples = array("h")
        samples.frombytes(source.readframes(source.getnframes()))
    if sys.byteorder != "little":
        samples.byteswap()
    pcm = array("f", (sample / 32768.0 for sample in samples))

    model = transcribe_cpp.Model(str(args.model), backend="auto")
    results = []
    session = model.session(n_threads=4)
    try:
        for seconds in (30, 15, 10, 5):
            parts = []
            for offset in range(0, len(pcm), seconds * 16_000):
                started = time.perf_counter()
                try:
                    result = session.run(
                        pcm[offset : offset + seconds * 16_000],
                        language="zh",
                        timestamps="segment",
                        diarize="on",
                    )
                    parts.append({
                        "startMs": offset // 16,
                        "status": "completed",
                        "characters": len(result.text),
                        "elapsedMs": round((time.perf_counter() - started) * 1000),
                    })
                except transcribe_cpp.OutputTruncated as error:
                    parts.append({
                        "startMs": offset // 16,
                        "status": "output_truncated",
                        "partialCharacters": len(error.partial_result.text)
                        if error.partial_result else None,
                        "elapsedMs": round((time.perf_counter() - started) * 1000),
                    })
            results.append({"chunkSeconds": seconds, "parts": parts})
    finally:
        session.close()
        model.close()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as target:
        json.dump(results, target, ensure_ascii=False, indent=2)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
