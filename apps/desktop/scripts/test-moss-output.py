"""Exercise the actual adapter method without loading model weights or torch."""
import ast
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any

source = Path(__file__).with_name('asr-runner.py').read_text(encoding='utf-8')
tree = ast.parse(source)
adapter = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'MossTranscribeDiarize')
scope = {'Any': Any, 'configure_threads': lambda _: None}
exec(compile(ast.Module(body=[adapter], type_ignores=[]), '<adapter>', 'exec'), scope)


class MossOutputTest(unittest.TestCase):
    def run_adapter(self, raw, parsed):
        runtime = scope['MossTranscribeDiarize'].__new__(scope['MossTranscribeDiarize'])
        runtime.model = runtime.processor = runtime.device = runtime.dtype = None
        runtime.build_messages = lambda path: path
        runtime.generate_transcription = lambda *args, **kwargs: {'text': raw}
        runtime.parse_transcript = lambda text: parsed
        return runtime.transcribe('unused.wav', 'normal')

    def test_markers_are_not_transcript(self):
        raw = '[0.1][S01][0.2]' * 100
        output = self.run_adapter(raw, [])
        self.assertEqual(output['text'], '')
        self.assertEqual(output['segments'], [])
        self.assertEqual(output['rawText'], raw)

    def test_valid_speech_and_timing_unchanged(self):
        output = self.run_adapter('[1.25][S02]你好[2.5]', [
            SimpleNamespace(text='你好', start=1.25, end=2.5, speaker='S02')])
        self.assertEqual(output['text'], '你好')
        self.assertEqual(output['segments'], [dict(text='你好', startMs=1250, endMs=2500, speakerId='S02')])


if __name__ == '__main__':
    unittest.main()
