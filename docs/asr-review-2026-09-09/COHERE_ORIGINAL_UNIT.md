# Cohere original failed unit follow-up (2026-09-10)

Recording: `7d096d64-2e3b-4279-8624-21295ad5bcb0`.
Source timeline: 510001–540001 ms. Participant track starts at 1 ms,
so extraction uses track-local 510000–540000 ms, not mixed recording audio.
Track: `0000-2093499924174864384-1-2416830.webm` in the recording's
`shanghao-desktop/participant-tracks/recordings` directory.

Isolated official Transformers invocation, same installed checkpoint
`00c06981f239c788c0ce23b8caa001c071e4e391`, CUDA BF16, deterministic
generation with max_new_tokens=512, mono PCM16 at 16 kHz:

- Transformers 5.15.0 / Torch 2.11.0+cu128.
- Load 2.913 s; inference 2.121 s.
- Torch peak allocated memory 4034.724 MiB (not whole-device peak VRAM).
- Returned 534 characters but only 10 distinct characters, reproducing the
  highly repetitive output outside the application worker and benchmark queue.
- Original failed benchmark output was 533 characters / 9 distinct characters.

Private artifacts are under voice-memory/verification/
`cohere-original-unit-20260910-510001/official`. The experiment JSON timestamps
are clip-local 0–30000 ms; the original source mapping is documented above.
No transcript contents are copied into this report.

The first experiment launcher omitted the provider-specific Python path and
failed on missing librosa. This was corrected by using the existing `cohere`
runtime directory, without installing or changing dependencies. This launcher
failure is NOT counted as a model failure.

Conclusion: this sample's repetition is reproducible without the application
adapter/queue. This rules out those layers as the necessary cause for this
sample, but does not distinguish model weights from Transformers/runtime
behavior or speech-content sensitivity. It does not prove poor general ASR
accuracy, and does not justify removing the model. No product inference
parameters or historical benchmark records were changed.
