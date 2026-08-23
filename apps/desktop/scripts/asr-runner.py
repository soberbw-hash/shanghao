"""Persistent local ASR worker using ShangHao's official-model adapters.

Electron supplies mono PCM16/16 kHz WAV chunks. Each adapter loads only local
weights and emits native timestamps when the official runtime provides them.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
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


def configure_threads(resource_mode: str) -> None:
    torch.set_num_threads(2 if resource_mode == "low" else 4)


def require_cuda(provider: str, *, bf16: bool = False) -> None:
    if not torch.cuda.is_available():
        raise RuntimeError(f"{provider}_cuda_required")
    if bf16 and not torch.cuda.is_bf16_supported():
        raise RuntimeError(f"{provider}_cuda_bf16_required")


def enable_legacy_distutils() -> None:
    """Activate setuptools' distutils shim for FunASR on Python 3.12+."""
    try:
        import setuptools  # noqa: F401
    except ModuleNotFoundError:
        return


class QwenAsr:
    def __init__(self, model_path: str, aligner_model_path: str, staged_on_oom: bool) -> None:
        from qwen_asr import Qwen3ASRModel, Qwen3ForcedAligner

        if not aligner_model_path:
            raise RuntimeError("qwen_forced_aligner_missing")
        require_cuda("qwen3_asr", bf16=True)
        self.model_path = model_path
        self.aligner_model_path = aligner_model_path
        self.asr_class = Qwen3ASRModel
        self.aligner_class = Qwen3ForcedAligner
        self.staged = False
        try:
            self.model = self._load_combined()
        except (RuntimeError, torch.OutOfMemoryError) as exc:
            if not staged_on_oom or "out of memory" not in str(exc).lower():
                raise
            self._release_cuda()
            self.staged = True
            self.model = self._load_asr()

    @staticmethod
    def _release_cuda() -> None:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    def _load_asr(self) -> Any:
        return self.asr_class.from_pretrained(
            self.model_path,
            dtype=torch.bfloat16,
            device_map="cuda:0",
            max_inference_batch_size=1,
            max_new_tokens=512,
        )

    def _load_combined(self) -> Any:
        return self.asr_class.from_pretrained(
            self.model_path,
            dtype=torch.bfloat16,
            device_map="cuda:0",
            max_inference_batch_size=1,
            max_new_tokens=512,
            forced_aligner=self.aligner_model_path,
            forced_aligner_kwargs={"dtype": torch.bfloat16, "device_map": "cuda:0"},
        )

    def _align_staged(self, wav_path: str, text: str) -> list[Any]:
        del self.model
        self._release_cuda()
        aligner = None
        try:
            aligner = self.aligner_class.from_pretrained(
                self.aligner_model_path,
                dtype=torch.bfloat16,
                device_map="cuda:0",
            )
            aligned = aligner.align(audio=wav_path, text=text, language="Chinese")
            return aligned[0] if isinstance(aligned, list) and aligned else []
        finally:
            if aligner is not None:
                del aligner
            self._release_cuda()
            self.model = self._load_asr()

    @staticmethod
    def _segments(result: Any) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        items = result if isinstance(result, list) else getattr(result, "time_stamps", None) or []
        for item in items:
            text = str(getattr(item, "text", "") or "").strip()
            start = getattr(item, "start_time", None)
            end = getattr(item, "end_time", None)
            if isinstance(item, dict):
                text = str(item.get("text", text)).strip()
                start = item.get("start_time", item.get("start", start))
                end = item.get("end_time", item.get("end", end))
            if not text or start is None or end is None:
                continue
            output.append(
                {
                    "startMs": max(0, round(float(start) * 1000)),
                    "endMs": max(round(float(start) * 1000) + 100, round(float(end) * 1000)),
                    "text": text,
                }
            )
        return output

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        results = self.model.transcribe(
            audio=wav_path,
            language="Chinese",
            return_time_stamps=not self.staged,
        )
        result = results[0] if isinstance(results, list) and results else results
        text = str(getattr(result, "text", "") or "").strip()
        if self.staged:
            aligned_items = self._align_staged(wav_path, text) if text else []
            return {"text": text, "segments": self._segments(aligned_items)}
        return {
            "text": text,
            "segments": self._segments(result),
        }


class FunAsrNano:
    def __init__(self, model_path: str) -> None:
        enable_legacy_distutils()
        from funasr import AutoModel

        require_cuda("fun_asr_nano_2512", bf16=True)
        self.model = AutoModel(
            model=str(Path(model_path)),
            trust_remote_code=True,
            device="cuda:0",
            ncpu=2,
            disable_update=True,
            disable_pbar=True,
        )

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        generated = self.model.generate(
            input=wav_path,
            batch_size=1,
            language="中文",
            use_itn=True,
            bf16=True,
            disable_pbar=True,
        )
        result = generated[0] if isinstance(generated, list) and generated else generated
        if isinstance(result, dict):
            return {"text": str(result.get("text", result.get("raw_text", ""))).strip()}
        return {"text": str(result or "").strip()}


class GlmAsr:
    def __init__(self, model_path: str) -> None:
        from transformers import AutoModel, AutoProcessor

        require_cuda("glm_asr_nano_2512", bf16=True)
        self.device = torch.device("cuda:0")
        self.dtype = torch.bfloat16
        self.processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
        self.model = AutoModel.from_pretrained(
            model_path,
            local_files_only=True,
            dtype=self.dtype,
            device_map=str(self.device),
        )
        self.model.eval()

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "audio", "url": wav_path},
                    {"type": "text", "text": "请将这段音频准确转写为简体中文。"},
                ],
            }
        ]
        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(self.device, dtype=self.dtype)
        with torch.inference_mode():
            outputs = self.model.generate(
                **inputs,
                max_new_tokens=512,
                do_sample=False,
                num_beams=1,
            )
        generated = outputs[:, inputs.input_ids.shape[1] :]
        text = self.processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
        return {"text": text}


class FireRedAsr:
    def __init__(self, model_path: str) -> None:
        from fireredasr2s.fireredasr2 import FireRedAsr2, FireRedAsr2Config

        require_cuda("fireredasr2_aed")
        config = FireRedAsr2Config(
            use_gpu=True,
            use_half=True,
            beam_size=3,
            nbest=1,
            decode_max_len=0,
            softmax_smoothing=1.25,
            aed_length_penalty=0.6,
            eos_penalty=1.0,
            return_timestamp=True,
        )
        self.model = FireRedAsr2.from_pretrained("aed", model_path, config)

    @staticmethod
    def _segments(result: dict[str, Any]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for item in result.get("timestamp", []) or []:
            if not isinstance(item, (list, tuple)) or len(item) < 3:
                continue
            text = str(item[0]).strip()
            if not text:
                continue
            output.append(
                {
                    "startMs": max(0, round(float(item[1]) * 1000)),
                    "endMs": max(round(float(item[1]) * 1000) + 100, round(float(item[2]) * 1000)),
                    "text": text,
                }
            )
        return output

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        results = self.model.transcribe(["shanghao"], [wav_path])
        result = results[0] if isinstance(results, list) and results else {}
        if not isinstance(result, dict):
            return {"text": str(result or "").strip()}
        return {
            "text": str(result.get("text", "")).strip(),
            "segments": self._segments(result),
        }


class ParaformerAsr:
    def __init__(self, model_path: str, vad_model_path: str, punc_model_path: str) -> None:
        enable_legacy_distutils()
        from funasr import AutoModel

        if not vad_model_path or not punc_model_path:
            raise RuntimeError("paraformer_bundle_incomplete")
        self.model = AutoModel(
            model=str(Path(model_path)),
            vad_model=str(Path(vad_model_path)),
            vad_kwargs={"max_single_segment_time": 30_000},
            punc_model=str(Path(punc_model_path)),
            device="cuda:0" if torch.cuda.is_available() else "cpu",
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
        configure_threads(resource_mode)
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


class MossTranscribeDiarize:
    """Official Transformers inference and official transcript parser."""

    def __init__(self, model_path: str) -> None:
        from transformers import AutoModelForCausalLM, AutoProcessor

        from moss_transcribe_diarize import parse_transcript
        from moss_transcribe_diarize.inference_utils import (
            build_transcription_messages,
            generate_transcription,
        )

        require_cuda("moss_transcribe_diarize", bf16=True)
        self.device = torch.device("cuda:0")
        self.dtype = torch.bfloat16
        self.parse_transcript = parse_transcript
        self.build_messages = build_transcription_messages
        self.generate_transcription = generate_transcription
        self.processor = AutoProcessor.from_pretrained(
            model_path,
            trust_remote_code=True,
            local_files_only=True,
        )
        self.model = AutoModelForCausalLM.from_pretrained(
            model_path,
            trust_remote_code=True,
            local_files_only=True,
            dtype="auto",
        ).to(dtype=self.dtype).to(self.device).eval()

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        result = self.generate_transcription(
            self.model,
            self.processor,
            self.build_messages(wav_path),
            max_new_tokens=2048,
            do_sample=False,
            device=self.device,
            dtype=self.dtype,
        )
        raw_text = str(result.get("text", "")).strip()
        segments = []
        for item in self.parse_transcript(raw_text):
            text = str(getattr(item, "text", "") or "").strip()
            if not text:
                continue
            start = float(getattr(item, "start", 0.0) or 0.0)
            end = float(getattr(item, "end", start) or start)
            segments.append(
                {
                    "startMs": max(0, round(start * 1000)),
                    "endMs": max(round(start * 1000) + 100, round(end * 1000)),
                    "speakerId": str(getattr(item, "speaker", "S01") or "S01"),
                    "text": text,
                }
            )
        return {"text": "".join(item["text"] for item in segments) or raw_text, "segments": segments}


class DolphinCnDialect:
    """Official 0.4B small.cn non-streaming runtime with word timing enabled."""

    def __init__(self, model_path: str) -> None:
        import dolphin

        require_cuda("dolphin_cn_dialect")
        self.transcribe_audio = dolphin.transcribe
        self.model = dolphin.load_model("small.cn", model_dir=model_path, device="cuda:0")

    @staticmethod
    def _words(text: str, raw_times: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_times, (list, tuple)):
            return []
        tokens = text.split() if " " in text.strip() else list(text.strip())
        output = []
        for token, timing in zip(tokens, raw_times):
            start = end = None
            if isinstance(timing, dict):
                start = timing.get("start", timing.get("start_time"))
                end = timing.get("end", timing.get("end_time"))
            elif isinstance(timing, (list, tuple)) and len(timing) >= 2:
                start, end = timing[0], timing[1]
            if start is None or end is None:
                continue
            start_ms = max(0, round(float(start) * 1000))
            end_ms = max(start_ms + 20, round(float(end) * 1000))
            output.append({"startMs": start_ms, "endMs": end_ms, "text": token})
        return output

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        result = self.transcribe_audio(
            self.model,
            wav_path,
            lang_sym="zh",
            region_sym="CN",
            predict_time=True,
            word_timestamp=True,
            beam_size=1,
            hotwords=None,
            use_deep_biasing=False,
        )
        text = str(getattr(result, "text_nospecial", None) or getattr(result, "text", "") or "").strip()
        words = self._words(text, getattr(result, "word_timestamps", None))
        if words:
            return {
                "text": text,
                "segments": [{
                    "startMs": words[0]["startMs"],
                    "endMs": words[-1]["endMs"],
                    "text": text,
                    "words": words,
                }],
            }
        return {"text": text}


class CohereTranscribe:
    """Official local Transformers runtime; ForcedAligner is a non-blocking enhancement."""

    def __init__(self, model_path: str, aligner_model_path: str) -> None:
        from transformers import AutoProcessor, CohereAsrForConditionalGeneration

        require_cuda("cohere_transcribe", bf16=True)
        self.device = torch.device("cuda:0")
        self.dtype = torch.bfloat16
        self.processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
        self.model = CohereAsrForConditionalGeneration.from_pretrained(
            model_path,
            local_files_only=True,
            dtype=self.dtype,
            device_map="cuda:0",
        ).eval()
        self.aligner = None
        if aligner_model_path:
            try:
                from qwen_asr import Qwen3ForcedAligner

                self.aligner = Qwen3ForcedAligner.from_pretrained(
                    aligner_model_path,
                    dtype=self.dtype,
                    device_map="cuda:0",
                )
            except (ImportError, ModuleNotFoundError, RuntimeError, torch.OutOfMemoryError):
                self.aligner = None
                torch.cuda.empty_cache()

    @staticmethod
    def _aligned_segments(items: Any) -> list[dict[str, Any]]:
        output = []
        values = items if isinstance(items, list) else []
        for item in values:
            text = str(getattr(item, "text", "") or "").strip()
            start = getattr(item, "start_time", None)
            end = getattr(item, "end_time", None)
            if isinstance(item, dict):
                text = str(item.get("text", text) or "").strip()
                start = item.get("start_time", item.get("start", start))
                end = item.get("end_time", item.get("end", end))
            if not text or start is None or end is None:
                continue
            start_ms = max(0, round(float(start) * 1000))
            output.append({
                "startMs": start_ms,
                "endMs": max(start_ms + 20, round(float(end) * 1000)),
                "text": text,
            })
        return output

    def transcribe(self, wav_path: str, resource_mode: str) -> dict[str, Any]:
        configure_threads(resource_mode)
        audio, sample_rate = read_pcm16_mono(wav_path)
        inputs = self.processor(
            audio,
            sampling_rate=sample_rate,
            return_tensors="pt",
            language="zh",
            punctuation=True,
        )
        audio_chunk_index = inputs.get("audio_chunk_index")
        inputs = inputs.to(self.device, dtype=self.dtype)
        with torch.inference_mode():
            outputs = self.model.generate(**inputs, max_new_tokens=512, do_sample=False)
        decoded = self.processor.decode(
            outputs,
            skip_special_tokens=True,
            audio_chunk_index=audio_chunk_index,
            language="zh",
        )
        text = str(decoded[0] if isinstance(decoded, list) and decoded else decoded or "").strip()
        if not text or self.aligner is None:
            return {"text": text}
        try:
            aligned = self.aligner.align(audio=wav_path, text=text, language="Chinese")
            items = aligned[0] if isinstance(aligned, list) and aligned else []
            words = self._aligned_segments(items)
            if words:
                return {
                    "text": text,
                    "segments": [{
                        "startMs": words[0]["startMs"],
                        "endMs": words[-1]["endMs"],
                        "text": text,
                        "words": words,
                    }],
                }
        except (RuntimeError, torch.OutOfMemoryError):
            torch.cuda.empty_cache()
        return {"text": text}


def load_runtime(args: argparse.Namespace) -> Any:
    if args.provider == "qwen3-asr-1.7b-force":
        return QwenAsr(args.model, args.aligner_model, staged_on_oom=True)
    if args.provider == "qwen3-asr-0.6b-force":
        return QwenAsr(args.model, args.aligner_model, staged_on_oom=False)
    if args.provider == "fun-asr-nano-2512":
        return FunAsrNano(args.model)
    if args.provider == "glm-asr-nano-2512":
        return GlmAsr(args.model)
    if args.provider == "fireredasr2-aed":
        return FireRedAsr(args.model)
    if args.provider == "paraformer-zh":
        return ParaformerAsr(args.model, args.vad_model, args.punc_model)
    if args.provider == "moss-transcribe-diarize-0.9b":
        return MossTranscribeDiarize(args.model)
    if args.provider == "dolphin-cn-dialect-0.4b":
        return DolphinCnDialect(args.model)
    if args.provider == "cohere-transcribe-2b":
        return CohereTranscribe(args.model, args.aligner_model)
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
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "id": request_id, "error": str(exc)})
    del runtime
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--provider",
        required=True,
        choices=(
            "qwen3-asr-1.7b-force",
            "qwen3-asr-0.6b-force",
            "fun-asr-nano-2512",
            "glm-asr-nano-2512",
            "fireredasr2-aed",
            "paraformer-zh",
            "moss-transcribe-diarize-0.9b",
            "dolphin-cn-dialect-0.4b",
            "cohere-transcribe-2b",
        ),
    )
    parser.add_argument("--model", required=True)
    parser.add_argument("--aligner-model", default="")
    parser.add_argument("--vad-model", default="")
    parser.add_argument("--punc-model", default="")
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if not args.worker:
        raise RuntimeError("asr_runner_requires_worker_mode")
    return run_worker(args)


if __name__ == "__main__":
    raise SystemExit(main())
