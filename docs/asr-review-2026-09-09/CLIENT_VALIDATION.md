# Client validation follow-up — 2026-09-12

The isolated Electron runtime smoke used the bundled quick-reply sound and
Paraformer, not a user recording. Runtime inference returned nonempty English
text, but final segments were empty and outputStatus was empty_output_on_speech.
The previous harness nevertheless printed ok:true. This was not an E2E pass.

Code inspection identifies a sufficient cause: isChinesePreferredTranscriptText
rejects text without a Han character, and normalizePythonAsrResult applies it
to both structured output and fallback text. This is application filtering,
not evidence that Paraformer returned nothing or failed to load. Whether the
recognition matches the source audio has not been manually verified.

The smoke harness now requires normal status and nonempty final text before
reporting success. Its success log contains counts/timing/resources, not the
transcript body. No production filtering, model parameters, benchmark results,
or user recordings were changed. The updated harness still needs execution.

Observed runtime: RTX 4060 Ti, CUDA 12.8, Torch 2.11.0+cu128; 37.187 seconds
overall, reported load 36.721 seconds and inference 0.410 seconds. No Python
or Electron processes remained in the post-run inventory. These numbers are
one short cold-start check, not long-recording throughput.

Still pending: real renderer model selection/start/pause/resume/result display
with isolated records and a real backend. A runtime-only test cannot certify
those interactions. Do not repeat the already completed 88-item suite.

## Harness failure-path execution verified

Rebuilt the development main/test entrypoints and reran the same sample with
captured process exit status. The updated harness exited **1** with
`smoke_transcription_rejected:empty_output_on_speech:segments=0`, without
printing a successful result or transcript body. The following process
inventory contained no Python or Electron processes. Desktop typecheck passed
before this build. This verifies the harness rejects this failure; it does not
resolve production English-text filtering or certify client interactions.

## Language-filter correction in progress

The shared script check now accepts standalone Latin text and numbers, not
only text containing Han characters. Existing silence, repetition, encoding,
and unsupported-script guards remain. This addresses the proven application
loss of English/game terms without changing inference parameters. Two new
regression tests and desktop typecheck pass. Full smoke is NOT yet green:
voice-memory.test.ts still explicitly expects Portuguese/Latin-only text to
be rejected as hallucination. Script alone cannot distinguish valid English
from hallucinated Portuguese; these assumptions need careful test review.
Do not call this correction fully verified or rescore historical results.

### Language correction verification completed

Reviewed and replaced the two obsolete Latin-equals-hallucination assertions:
without audio evidence, Portuguese text also cannot be declared hallucinated
solely by script. Unsupported-script and repetition checks remain covered.
Full desktop smoke now passes **549/549**. Rebuilt main entrypoints and ran
the same actual Electron/Paraformer sample: exit 0, normal status, one final
segment; 15.190 s overall, 14.774 s reported load, 0.368 s inference, CUDA:0,
worker peak RAM 6200.41 MiB, recorded OOM/crash 0. No body was logged.
This proves the previously dropped output survives the runtime path, not
recognition accuracy or renderer interaction. Historical scores stay untouched.

## Isolation prerequisites found during client harness review

Do not start the existing visual fixture unchanged for ASR acceptance:

- capture mode isolates userData and AI directories, but does not override
  Electron's documents path. recording-library.ts defaults to Documents/上号录音
  when recordingSaveDirectory is absent. Therefore capture isolation alone
  does not isolate the recording library. Seed an explicit disposable recording
  directory before reading the library; verify fallback paths too.
- tests/visual/start-local-fixture.mjs constructs SignalingServer without a
  host option; server.ts listenOnPort binds ::, with 0.0.0.0 fallback. A local
  ws URL does not make that listener loopback-only. Avoid this fixture unchanged;
  preferably enter settings without joining any room, or build a loopback-only
  test fixture without altering production server behavior.

No client/fixture was launched during this inspection. These are test-isolation
gaps, not evidence of a new production ASR crash.

### Capture fallback guard added

Development capture bootstrap now creates and sets a capture-specific Documents
path before settings loading. Thus absent/unusable recordingSaveDirectory falls
back inside the capture directory rather than the user's real Documents folder.
Packaged and ordinary development launches are unchanged. Desktop typecheck
passes. This guards fallback only: use fresh capture userData and never copy
production settings containing an explicit recordingSaveDirectory into it.
Actual renderer acceptance remains pending; no client was launched in this step.

### Direct settings entry found (no room fixture required)

App.tsx already handles `?visualCapture=settings` in DEV after bootstrap ready,
with settingsReturnTo=home. window.ts reads VITE_DEV_SERVER_URL, so the isolated
client can use `http://127.0.0.1:5173/?visualCapture=settings` and avoid joining
a room entirely. Keep SHANGHAO_CAPTURE_MODE=home and CAPTURE_EXIT=0 so the
capture driver does not perform its non-home join sequence. Select Recording
Library through the actual settings UI afterward. This is an existing route,
not a production navigation change or a completed interaction test.

Capture fallback path unit regression now passes (8 recording-path tests),
including preferred directory failure; no actual filesystem writes in the new
test callback. Remaining setup is isolated model/runtime resources and a small
recording fixture, followed by actual UI actions against the backend.

### Isolated resources staging started

Fresh root: `output/playwright/asr-client-61603a4d547c4f48b46de5468653f836`.
Copying (not linking) installed python, cuda-python-v3, asr-python-v3/funasr,
and Paraformer bundle-d7811ee3-df20e6b3-d0e55e2b into its ai directory. Source
runtime sizes are 4.41, 4.27, 0.65 GiB; model state reports 2,027,343,620 bytes.
Free space before staging was 227,848,847,360 bytes. No production state.json
or user settings are copied. Copy session 39215 was still running at this note;
verify completion before launching anything, and reuse this root rather than
starting another copy. This is preparation, not a passed client test.

Staging completed with exit 0 for all four directories. Isolated Python starts
and reports its copied venv as sys.prefix (system Python312 remains base_prefix).
A new state.json contains only the staged Paraformer model and empty task
checkpoints. Inspection found model-manager fallback hydration would otherwise
discover production legacy model directories; development capture now passes
an empty fallback list. Ordinary launches retain all existing fallback paths.
Desktop typecheck passes. Still no client launch or actual UI test yet.
