"""Bounded native MOSS truncation fallback, using a fake decoder only."""

import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import wave


RUNNER = Path(__file__).resolve().parents[1] / "scripts" / "asr-runner.py"
SPEC = importlib.util.spec_from_file_location("shanghao_asr_runner", RUNNER)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class OutputTruncated(Exception):
    pass


class FakeSession:
    def __init__(self, max_samples: int):
        self.max_samples = max_samples
        self.calls = []

    def run(self, samples, **_options):
        self.calls.append(len(samples))
        if len(samples) > self.max_samples:
            raise OutputTruncated()
        duration_ms = len(samples) // 16
        return SimpleNamespace(
            text="正常",
            raw_text="正常",
            segments=[SimpleNamespace(text="正常", t0_ms=0, t1_ms=duration_ms, speaker_id=0)],
            words=[],
            speaker_segments=[],
            timings=SimpleNamespace(load_ms=1, encode_ms=2, decode_ms=3),
        )


class MossFallbackTest(unittest.TestCase):
    def run_with_limit(self, max_samples: int):
        with tempfile.TemporaryDirectory() as directory:
            wav_path = Path(directory) / "synthetic.wav"
            with wave.open(str(wav_path), "wb") as target:
                target.setnchannels(1)
                target.setsampwidth(2)
                target.setframerate(16_000)
                target.writeframes(b"\0\0" * 480_000)
            adapter = object.__new__(module.MossTranscribeDiarizeQ8)
            adapter.session = FakeSession(max_samples)
            adapter.model = SimpleNamespace(
                backend="test", device=SimpleNamespace(device_type="test", name="test")
            )
            adapter.transcribe_cpp = SimpleNamespace(OutputTruncated=OutputTruncated)
            adapter.backend_fallback = False
            result = adapter.transcribe(str(wav_path), "normal")
            adapter.session = None
            adapter.model = None
            return result

    def test_normal_decoder_keeps_one_native_result(self):
        result = self.run_with_limit(480_000)
        self.assertEqual(len(result["segments"]), 1)
        self.assertEqual(result["metrics"]["truncationFallbackParts"], 0)

    def test_truncated_30_seconds_retries_in_10_second_parts(self):
        result = self.run_with_limit(160_000)
        self.assertEqual([segment["startMs"] for segment in result["segments"]], [0, 10_000, 20_000])
        self.assertEqual(result["metrics"]["truncationFallbackParts"], 3)
        self.assertEqual(result["metrics"]["nativeDecodeTimeMs"], 9)

    def test_truncated_10_seconds_retries_in_5_second_parts(self):
        result = self.run_with_limit(80_000)
        self.assertEqual(len(result["segments"]), 6)
        self.assertEqual(result["metrics"]["truncationFallbackParts"], 6)
        self.assertEqual(result["segments"][-1]["endMs"], 30_000)


if __name__ == "__main__":
    unittest.main()
