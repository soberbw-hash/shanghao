# v0.1.50 implementation checkpoint

This file is the durable checkpoint for the v0.1.50 product pass. It is updated as each group lands so an interrupted run can resume without relying on chat history.

## Baseline

- Branch: `codex/v0150-complete-optimization`
- Baseline: `v0.1.49` / `e1f5653`
- `pnpm install --frozen-lockfile`: passed
- `pnpm typecheck`: passed
- desktop smoke tests: 75/75 passed
- three-peer audio test: passed, including relay fallback

## Delivery order

1. Remove AI, room notes, custom status, and random nicknames from every layer.
2. Make server sessions authoritative, validate messages, rate-limit abuse, and persist the latest 100 chat messages.
3. Make mute/deafen atomic, use system-idle away/return, expose latency, and persist per-member volume.
4. Harden Electron settings, IPC, media permissions, avatar files, overlay preload, and window restoration.
5. Unify typography, semantic colors, material, motion, accessibility, room layout, chat, and screen sharing.
6. Add deployment hardening, lint/format/CI/security checks, SHA256 release output, and regression coverage.
7. Run install, typecheck, lint, tests, smoke, three-peer audio, build, and Windows distribution.
8. Commit, push, and publish the single final `v0.1.50` release.

## Current status

- [x] Baseline reproduced
- [x] Existing implementation audited
- [x] Legacy features removed
- [x] Signaling and chat hardened
- [x] Audio, away, latency, sounds, and game detection complete
- [x] Electron hardening complete
- [x] Design and motion pass complete
- [x] Full verification complete
- [x] GitHub release published

## Final local verification

- Lint, Prettier, and all six workspace TypeScript projects passed.
- All 75 desktop regression tests passed, including protocol compatibility, auto-away boundaries, secure signaling, chat history recovery, duplicate-seat arbitration, screen sharing, updates, and asset packaging.
- The three-client audio matrix passed every peer route and the signaling-audio fallback path without stale frames.
- The packaged runtime contains the RNNoise AudioWorklet, 199 offline Noto Sans SC font files, and every required third-party license.
- Windows NSIS coverage installation passed twice. The second pass started with six ShangHao processes and ended with zero locked processes, exit code 0, and installed product version 0.1.50.
- SHA256 checksums were generated for exactly the installer, blockmap, and `latest.yml` update metadata.
- GitHub Actions run `29188448594` rebuilt the package on a clean Windows runner and published the final `v0.1.50` release: <https://github.com/soberbw-hash/shanghao/releases/tag/v0.1.50>.
