"""Persistent local ASR worker for ShangHao.

The Electron host supplies an already normalized mono PCM16 WAV. Qwen is forced to
Chinese at the processor level; Paraformer uses the pinned local ASR/VAD/punctuation
directories and never downloads models at inference time.
"""

from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path
from typing import Any

import numpy as np
import torch


sys.stdout.reconfigure(encoding="utf-8", errors="strict", line_buffering=True)
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace", line_buffering=True)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def read_pcm16_mono(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        sample_rate = source.getframerate()
        frames = source.readframes(source.getnframes())
    if channels != 1 or sample_width != 2 or sample_rate != 16_000:
        raise RuntimeError(
            f"unsupported_asr_wav: channels={channels}, width={sample_width}, rate={sample_rate}"
        )
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    return audio, sample_rate


class QwenAsr:
    def __init__(self, model_path: str) -> None:
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        self.device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        self.dtype = torch.bfloat16 if self.device.type == "cuda" else torch.float32
        self.processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
        self.model = AutoModelForMultimodalLM.from_pretrained(
            model_path,
            local_files_only=True,
            dtype=self.dtype,
            low_cpu_mem_usage=True,
        ).to(self.device)
        self.model.eval()

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        audio, sample_rate = read_pcm16_mono(wav_path)
        torch.set_num_threads(2 if resource_mode == "low" else 4)
        inputs = self.processor.apply_transcription_request(
            audio=audio,
            language="Chinese",
            return_tensors="pt",
            audio_kwargs={"sampling_rate": sample_rate},
        ).to(self.device, dtype=self.dtype)
        with torch.inference_mode():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=512,
                do_sample=False,
                repetition_penalty=1.04,
            )
        generated = output_ids[:, inputs["input_ids"].shape[1] :]
        text = self.processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
        if "<asr_text>" in text:
            text = text.split("<asr_text>", 1)[1].strip()
        return {"text": text}


class ParaformerAsr:
    def __init__(self, model_path: str, vad_model_path: str, punc_model_path: str) -> None:
        from funasr import AutoModel

        if not vad_model_path or not punc_model_path:
            raise RuntimeError("paraformer_bundle_incomplete")
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = AutoModel(
            model=str(Path(model_path)),
            vad_model=str(Path(vad_model_path)),
            vad_kwargs={"max_single_segment_time": 30_000},
            punc_model=str(Path(punc_model_path)),
            device=device,
            ncpu=2,
            disable_update=True,
            disable_pbar=True,
        )

    @staticmethod
    def _segments(result: dict[str, Any]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        sentence_info = result.get("sentence_info")
        if not isinstance(sentence_info, list):
            return output
        for sentence in sentence_info:
            if not isinstance(sentence, dict):
                continue
            text = str(sentence.get("text", "")).strip()
            if not text:
                continue
            start = sentence.get("start", sentence.get("start_ms", 0))
            end = sentence.get("end", sentence.get("end_ms", start))
            try:
                start_ms = max(0, int(float(start)))
                end_ms = max(start_ms + 100, int(float(end)))
            except (TypeError, ValueError):
                continue
            output.append({"startMs": start_ms, "endMs": end_ms, "text": text})
        return output

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        torch.set_num_threads(2 if resource_mode == "low" else 4)
        generated = self.model.generate(
            input=wav_path,
            batch_size_s=30,
            sentence_timestamp=True,
            return_raw_text=True,
            disable_pbar=True,
        )
        result = generated[0] if isinstance(generated, list) and generated else {}
        if not isinstance(result, dict):
            return {"text": str(result).strip()}
        return {
            "text": str(result.get("text", "")).strip(),
            "segments": self._segments(result),
        }


def load_runtime(args: argparse.Namespace) -> Any:
    if args.provider == "qwen3-asr-0.6b":
        return QwenAsr(args.model)
    if args.provider == "paraformer-zh":
        return ParaformerAsr(args.model, args.vad_model, args.punc_model)
    raise RuntimeError(f"unsupported_asr_provider: {args.provider}")


def run_worker(args: argparse.Namespace) -> int:
    emit({"type": "loading"})
    runtime = load_runtime(args)
    emit({"type": "ready"})
    for raw_line in sys.stdin.buffer:
        request_id = ""
        try:
            request = json.loads(raw_line.decode("utf-8", errors="strict"))
            request_id = str(request.get("id", ""))
            if not request_id:
                raise RuntimeError("missing_request_id")
            output = runtime.transcribe(
                str(request.get("wavPath", "")),
                str(request.get("resourceMode", "normal")),
            )
            emit({"type": "result", "id": request_id, "output": output})
        except Exception as exc:
            emit({"type": "error", "id": request_id, "error": str(exc)})
    del runtime
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", required=True, choices=("qwen3-asr-0.6b", "paraformer-zh"))
    parser.add_argument("--model", required=True)
    parser.add_argument("--vad-model", default="")
    parser.add_argument("--punc-model", default="")
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if not args.worker:
        raise RuntimeError("asr_runner_requires_worker_mode")
    return run_worker(args)


if __name__ == "__main__":
    raise SystemExit(main())
