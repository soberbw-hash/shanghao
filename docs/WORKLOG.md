# ShangHao active work log

Updated: 2026-08-22

## Current objective

Implement the local ShangHao 3.0.2 performance stabilization plan on top of the 3.0.1 local baseline.

## 2026.08.22 release candidate

- Confirmed the authoritative local checkout still contains the complete unpublished 3.0.1 work plus the 3.0.2 stabilization changes; the remote 3.0.0 history was not used to overwrite local files.
- Replaced display-refresh-driven local speaking analysis with a fixed 30 Hz analysis clock and moved seat travel to compositor keyframes.
- Disabled continuous layered character idle loops, kept speaking/walking/state feedback, and paused decorative work around room entry and seat movement.
- Stopped superseded signaling clients and prevented connected but quiet peers from entering a periodic ICE/peer rebuild loop.
- Prepared version 3.0.2 metadata and release notes after explicit authorization to package, push and publish once all release checks pass.
- Passed ESLint, Prettier, workspace typecheck, 354/354 desktop smoke tests, Electron AudioWorklet, five-peer audio/media, and 2/2 Rust tests.
- Built and verified `ShangHao-3.0.2-Setup-x64.exe`; packaged fonts, DeepFilterNet assets, licenses, install manifest, execution level, blockmap and checksums passed.
- After the first public 3.0.2 update, traced `ai_runtime_integrity_failed` to a stale Qwen runner SHA256 in `runtime-manifest.json`; the packaged runner was current but the manifest still pinned the previous script.
- Corrected the manifest, made optional AI runtime preparation non-fatal to the main application, removed the packaged unverified duplicate runner copy, and added source/package hash regression checks.
- Added `docs/stabilization-reference-3.0.2.md` with the observed performance symptoms, confirmed causes, fixes, intentionally rejected dynamic-blur workaround, and future diagnostic order.
- Confirmed paused transcription already persists a checkpoint every 30 seconds; added a regression test proving “continue transcription” keeps that checkpoint instead of requesting a clean restart.
- Traced Paraformer startup failure to a missing `torchaudio` package in the isolated FunASR runtime; runtime repair now installs the wheel matching the bundled PyTorch version and CUDA index.
- Split text AI routing from ASR: recording organization and room questions can independently use room cloud AI, local Qwen, or an encrypted user-supplied OpenAI-compatible API.
- Added a joined-room-only cloud AI signaling path with bounded payloads, rate/concurrency limits, timeouts and sanitized errors. The server reads DeepSeek configuration only from `/opt/shanghao/.env`; no provider key is present in client settings, IPC responses, logs, source or release assets.
- Cloud room questions use server-side web search when supported; model output source identifiers are mapped back to local recording paths inside the main process so local file paths are not sent upstream.
- Persist the ASR model name and revision with each completed or partial transcript; the recording list and detail view now show which model produced the text, while legacy records are backfilled from compatible checkpoints or marked as unknown.
- Added a visible “停止回答” action for room questions. Cancellation now propagates through IPC to local Qwen, custom HTTP providers and the joined-room cloud request; closing the ask popover also stops active work, and Relay aborts its upstream fetch instead of holding the connection busy until timeout.

## 2026.08.21

- Confirmed `git status`, `git diff`, and `git diff --staged`: clean 3.0.0 baseline; no remote overwrite.
- Loaded motion-performance rules and preserved transform/opacity, bounded VisualRuntime, existing blur and realtime media paths.
- Moved screen-frame freshness clock and relay-frame selection into `ScreenSharePanelContainer`.
- Replaced RoomPage whole audio-store subscription with selectors.
- Replaced member `JSON.stringify` equality with explicit field comparison and structural sharing.
- Added duplicate-frame suppression to the room store.
- Reduced overlay reconcile heartbeat from 250ms to 2s while retaining immediate state updates.
- Memoized `SceneCharacter` using stable member/semantic props and kept voice halo updates in CSS variables.
- Applied the requested -5 dB trim only to the “上号” quick-reply sound.
- Added typed Character Pack Protocol metadata and a real-value-only performance baseline template.
- Merged detached screen-share updates in a 200ms timer so relay JPEG churn does not issue one IPC call per frame.
- Replaced RoomPage music/work activity JSON dependency keys with primitive field keys.
- Extended RuntimeHealth GPU output with compositing, rasterization, WebGL/WebGL2, video decode/encode and ANGLE/backend fields.

## 3.0.2 performance stabilization

- Moved microphone protection/VAD/echo evidence and raw/DeepFilter mixing to an AudioWorklet audio clock; visual rAF no longer drives microphone processing.
- Kept the existing DeepFilter/AEC/voice-protection behavior and raw-audio fallback; worklet messages are throttled before React diagnostics publication.
- Changed screen relay fallback from 750ms to 250ms with single-flight canvas capture, preventing overlapping JPEG/IPC work.
- Added a visible `网络受限 · 备用画面` transport hint while retaining relay fallback.
- Replaced RoomPage's whole settings subscription with field selectors and a stable audio-dock settings subset.
- Added render attribution for RoomPage, TeamIsland, SceneCharacter and ScreenShare plus 50ms Long Task category counters.

## Completed

- P0 connection path:
  - Domestic STUN first, overseas STUN fallback.
  - Pending remote ICE candidate queue.
  - WebRTC ready state now follows `connectionState === "connected"`.
  - Signaling audio relay is disabled for WebRTC-ready peers and restored on failure.
  - Connection entry is now a single fixed-channel server URL with no client-side mode guessing.
  - Direct-host never shares LAN, loopback, pending, or unverified addresses.
  - Invite copying validates complete real `ws://` / `wss://` URLs.
- P1 connection modes:
  - Added Cloudflare Quick Tunnel mode with download, start, parse, stop, unexpected-exit state, and diagnostics.
  - Relay test now requires both `/health` and WebSocket open.
  - Added relay deployment docs and systemd service.
- P2 diagnostics:
  - Added Fake-IP/TUN diagnostics and host-session data to the diagnostics bundle.
  - Added ICE/audio relay/Cloudflare/relay lifecycle logs.
- P3 release:
  - Version unified at `0.1.21`.
  - Windows executable/shortcut use cache-busting v3 icon files.
  - Added Windows/macOS tag release workflow and repeatable clean/build scripts.

## Verification

- `corepack pnpm typecheck`: passed.
- `corepack pnpm --dir apps/desktop test:smoke`: passed, 35 tests.
- `corepack pnpm build`: passed.
- Real Cloudflare Quick Tunnel URL creation: passed.
- Real Cloudflare WSS open on this machine: blocked by the current Mihomo/TUN/network path with TLS `ECONNRESET`; the app now reports this instead of pretending the address is reachable.
- Local Windows NSIS build reached `win-unpacked/ShangHao.exe`, then the current non-admin Windows session blocked electron-builder from extracting winCodeSign symlinks. GitHub Actions Windows runner will perform the release build.

## 3.0.1 verification boundary

- `corepack pnpm typecheck`: passed after the performance pass.
- Focused architecture and room-layout tests: passed.
- `corepack pnpm --dir apps/desktop test:smoke`: passed, 340/340.
- Full smoke, real five-peer media, GPU/D3D11 A/B, 120/144Hz and long-session sampling remain manual and local-only.

## 3.0.2 verification boundary

- `corepack pnpm typecheck`: passed after the stabilization pass.
- Focused audio/room regression: 40/40 passed.
- Focused architecture/layout/diagnostics/screen-share/audio regression: 39/39 passed.
- Real-device AudioWorklet voice quality, five-person mesh, TURN/ICE recovery, RTX 4060 all-on scene, 120/144Hz, 2-hour session and before/after FPS/CPU/GPU/RAM measurements remain manual.

## Intentionally untouched

- `enable-low-latency-profile.ps1`
- `gaming-optimize-admin.ps1`
- `run-low-latency-profile-admin.cmd`
