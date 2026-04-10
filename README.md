# Quiet Team

Quiet Team is a Windows-first private voice desktop app for 3-5 fixed friends. It stays intentionally small:

- one room
- audio only
- host starts the room locally
- private networking designed around Tailscale
- manual recording only
- no accounts, no chat, no server list

## Current repository shape

```text
private-voice-app/
├─ apps/
│  └─ desktop/
│     ├─ electron-builder.yml
│     ├─ package.json
│     ├─ src/
│     │  ├─ main/
│     │  ├─ preload/
│     │  └─ renderer/
├─ packages/
│  ├─ recording/
│  ├─ shared/
│  ├─ signaling/
│  ├─ ui/
│  └─ webrtc/
├─ docs/
├─ scripts/
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
└─ tsconfig.base.json
```

## What is already implemented

- pnpm workspace monorepo skeleton
- Electron main process split into window, tray, shortcuts, IPC, diagnostics, Tailscale, recording export, and host session control
- React + TypeScript + Vite renderer shell
- Tailwind-based dark glass UI foundation
- Zustand stores for app, room, audio, settings, and recording
- `ws` signaling server with room snapshots, peer forwarding, heartbeats, stale peer cleanup, and five-member cap
- WebRTC mesh connection wrapper, audio constraints, speaking detector, and reconnect backoff
- room pages, settings pages, onboarding modal, status banners, and recording history UI
- manual recording pipeline with MIME capability detection and Electron-side `.m4a` export path

## What still needs runtime validation

This repository was created in an environment that does **not** currently have `node`, `pnpm`, or `git` available, so I could not install dependencies or run builds/tests here.

Before local validation, install:

- Node.js 20+
- pnpm 10+
- Git
- Tailscale (recommended for actual multi-machine testing)

## Quick start

1. Run `scripts/check-environment.ps1`
2. Install the missing tools it reports
3. Run `pnpm install`
4. Run `pnpm dev`
5. Open a second desktop instance on another machine in the same tailnet to test join flow

## Packaging

When the toolchain is installed, run:

```powershell
pnpm install
pnpm dist
```

That will build the desktop app and create a Windows installer in `apps/desktop/release`.

## Notes on recording export

- The renderer checks for direct AAC recording support first.
- If Chromium cannot record AAC directly, the main process writes a temporary file and transcodes it to AAC in `.m4a`.
- If export fails, the temporary file is kept and the returned error message points to it.

## Environment caveat

This repo is ready for the next validation pass, but the first real milestone after cloning should be:

1. install dependencies
2. run the app
3. fix any compile-time drift caused by package-version differences
4. test two-machine audio over Tailscale
