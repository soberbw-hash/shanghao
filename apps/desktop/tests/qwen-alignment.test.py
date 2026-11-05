import importlib.util
import unittest
from types import SimpleNamespace
from pathlib import Path

runner = Path(__file__).resolve().parents[1] / "scripts" / "asr-runner.py"
spec = importlib.util.spec_from_file_location("shanghao_asr_runner_alignment", runner)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AlignmentTests(unittest.TestCase):
    def test_context_is_per_request_and_empty_on_the_next_request(self):
        calls = []
        class FakeModel:
            def transcribe(self, **kwargs):
                calls.append(kwargs)
                return [SimpleNamespace(text="测试", time_stamps=[])]
        runtime = module.QwenAsr.__new__(module.QwenAsr)
        runtime.model = FakeModel()
        runtime.staged = False
        original = module.configure_threads
        module.configure_threads = lambda _mode: None
        try:
            first = runtime.transcribe("one.wav", "low", "游戏：甲")
            second = runtime.transcribe("two.wav", "low")
        finally:
            module.configure_threads = original
        self.assertEqual([call["context"] for call in calls], ["游戏：甲", ""])
        self.assertTrue(first["contextApplied"])
        self.assertFalse(second["contextApplied"])

    def test_preserves_short_real_interval(self):
        result = module.QwenAsr._segments([{"text": "好", "start": 0.1, "end": 0.125}])
        self.assertEqual(result, [{"text": "好", "startMs": 100, "endMs": 125}])

    def test_invalid_part_discards_alignment_instead_of_losing_its_text(self):
        for invalid in ({"text": "啊", "start": 0.2, "end": 0.2},
                        {"text": "啊", "start": 0.2},
                        {"text": "啊", "start": float("nan"), "end": 0.3}):
            with self.subTest(invalid=invalid):
                self.assertEqual(module.QwenAsr._segments([
                    {"text": "好", "start": 0.1, "end": 0.125}, invalid
                ]), [])


if __name__ == "__main__":
    unittest.main()
