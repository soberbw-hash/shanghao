# Recording and Room Experience Implementation Plan

> **For agentic workers:** Use executing-plans or the applicable independent-domain delegation workflow. Preserve this working tree. Checkbox items track implementation and verification separately.

**Goal:** Make recordings readable and automatically summarized, repair fusion and entry audio, and implement the requested temporary-room, remote-assistance and selected-application-audio capabilities without regressing permanent rooms.

**Architecture:** Keep the existing voice, screen-share, job and storage owners. Add narrow stateful capabilities around them; local processing results remain local until an explicit upload. Guest sessions use separate room namespaces and authenticated session membership; native input is authorized in Main before every event.

**Tech Stack:** Electron, React, TypeScript, Zustand, WebRTC, existing ws signaling, Rust Windows platform helpers.

**Spec:** User request of 2026-10-22 and `C:/Users/sober/.codex/attachments/eec8be9e-dd10-4812-a34e-7eef30849381/已粘贴的文本.txt`. The user explicitly requested planning followed by implementation, so continue without another planning approval gate.

## Global Constraints

- No release, deployment, version bump or EXE packaging before the user's acceptance.
- Latest user steering: complete the entire requested implementation and self-checks before arranging a single consolidated external review/acceptance. Do not repeatedly submit intermediate pieces for acceptance.
- Preserve all existing edits, recordings, credentials, original ASR variants and room isolation.
- Always summarize successful transcription; remove the manual organize control and its preference. Retain legacy fields only for migration compatibility. Never automatically publish a summary.
- Hybrid assistance defaults on; Qwen 0.6B is the auxiliary default. Missing local components fall back to cloud and offer an explicit download.
- Remote control requires explicit per-share consent, a single controller, expiration, immediate local revoke and held-key release. Window-only sharing remains view-only.
- Never inject native keyboard/mouse input into this user's active desktop as an automated test.
- Offline LAN and actual cross-network/two-device verification are distinct from simulated tests.

## Review Focus

- Starting transcription manually must run the same postprocessing as automatic admission; partial/failed transcription must not be represented as complete.
- Fusion failures, cancellations and resumed batches must preserve both originals and accurate source labels; text correction must not invent timestamp alignment.
- Older profiles enabling automatic upload must migrate to explicit-only publication.
- Late room and media callbacks must not replay stale audio or acquire another room's resources.
- Temporary-room credentials and remote-control grants must be invalid outside their member, room, share and epoch; disconnects must release native input.

## Task 1: Recording processing and presentation

**Files:** `main/automatic-voice-memory-request.ts`, `main/automatic-recording-backlog.ts`, `main/settings-migration.ts`, `main/recording-recap-upload.ts`, `main/recording-organizer.ts`, `main/ai-voice-memory-service.ts`; renderer `VoiceMemoryDetail.tsx`, `RecordingTranscriptionModelSelect.tsx`, `CloudLocalAssistControl.tsx`, `AiVoiceMemorySettingsCard.tsx`, `209-recording-library-clean.css`.

**Interfaces:** Preserve `VoiceMemoryProcessRequest`, `VoiceMemoryRecord`, existing resumable organizer and `processTranscriptFusion`. Start actions request organization; the automatic worker may internally defer summary behind transcription. `createRecordingRecapUploader` accepts only explicit manual publication.

- [x] Pin migration and admission behavior with regression tests: old false organize becomes true, old true upload becomes false, manual transcription requests summary, automatic publication never sends.
- [x] Implement automatic summary policy and compact factual summary prompts, retaining chunk coverage, failure checkpoints and retry actions.
- [x] Replace the long toolbar with transcript actions plus a collapsible processing-settings area. Show a readable overview above the transcript; hide technical metrics in details. Use source/version selection next to the transcript heading.
- [x] Verify real fusion eligibility and failure feedback, saved three-source switching, pause/resume and source-anchored seek in isolated fixtures. Inspect actual local runtime errors without logging transcript content.
- [x] Run scoped tests, typecheck, lint and render desktop/narrow screenshots; retain evidence for the final consolidated review.

## Task 2: Entry continuity, fonts and character grounding

**Files:** Existing room/audio lifecycle modules identified by audit; global font rules and `SceneCharacter` styles, `AboutSettingsCard.tsx`.

- [x] Trace synchronous entry work and queued audio ownership; write a failing race/load test for confirmed defects before changing the media path.
- [x] Prewarm immutable resources outside join; bound/drop stale playback only where identified, retain five-peer recovery and recording completeness.
- [x] Unify existing valid HarmonyOS assets and restore a stable contact shadow during movement; remove the font implementation note.
- [x] Run focused audio tests and five-peer regressions; distinguish simulated continuity from real headset verification. Actual headset/game audio acceptance remains separate.

## Task 3: Temporary room and remote assistance

**Audit:** `docs/superpowers/specs/2026-10-22-temporary-remote-audit.md` maps exact existing seams before implementation.

- [x] Define typed versioned session/membership/control messages, cryptographic guest identity storage and separate temporary session namespace.
- [x] Implement eight-digit code reservation, rate limits, capacity five, lock/kick/rotate, 30-second disconnect grace, admin transfer and immediate last-member teardown in the reusable coordinator.
- [x] Add LAN discovery without reusable join credentials, authenticated local coordination, epoch election/split-brain rejection; bridge the same sessions to existing internet signaling and ICE/relay paths. See the 2026-10-23 bridge evidence; the old deployed broker was not updated.
- [x] Integrate the compact guest entry and room management into existing room UI without permanent-account authorization bypass.
- [x] Implement share-bound control requests/grants/revoke/expiry, ordered DataChannel messages, coordinate mapping, native Windows fixed input operations, held-input cleanup, emergency stop and view-only capability fallback.
- [x] Test coordinator lifecycle, room isolation, security negative cases, two-client signaling integration and native-input dry-run mapping. Record unavailable two-device/LAN-offline/cross-network/60-minute checks explicitly.

## Task 4: Music and selected-application audio

- [x] Audit existing music link previews and screen-audio capture. Verify official Windows process-loopback support and reference licensing before borrowing implementation ideas.
- [x] Add an explicit selected-application source, independent gain, simultaneous microphone mixing through the current owned send track, visible room state, stop and source-exit cleanup. Do not capture the entire system by default.
- [x] Preserve actionable music links/cards for QQ, NetEase, Apple Music, Kugou, Spotify and Soda without bypassing provider access controls.
- [x] Verify no echo/duplicate capture, share-stop/room-leave cleanup and capability errors in isolated fixtures; a remote friend's actual hearing test remains unverified.

## Final integration

- [x] Update current-round notes and architecture budgets only for reviewed new modules, never enlarge existing caps.
- [x] Run applicable automated tests, typecheck, lint, Main/renderer builds and five-peer media/audio checks. Latest evidence and the non-reproduced intermittent connection observation are in `../specs/2026-10-24-code-cooldown-review.md`.
- [x] Submit substantive changes to the existing 上号审核 window, resolve important confirmed findings and obtain explicit review conclusions. The guessing-cooldown P2 and neutral-lookup increment both received explicit passing review.
- [x] Present the real development app for user acceptance; do not publish. Desktop launcher opened the current app, with a responsive window on 2026-10-24; user acceptance and hardware checks remain pending.
