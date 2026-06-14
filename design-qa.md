# ShangHao Design QA

final result: passed

## Baseline

- Target viewport: 1280 x 800
- Direction: white miniature office voice room with five recognizable 3D friends
- Reference assets: user-provided empty office scene and five-character sheet

## Verified

- Entry page is a single focused card with avatar, nickname, server address, microphone status, and enter action.
- Room page keeps the office scene, lightweight chat, top status, and audio controls visible at 1280 x 800.
- Other users' chat messages show avatars; local messages do not; system events are subdued.
- Speaking, muted, reconnecting, and offline states have distinct visual treatment.
- Low-frequency footer actions collapse to icons at the baseline width.
- The floating member strip is an independent always-on-top Electron BrowserWindow.

## Evidence

- `artifacts/room-1280-final.png`
- `corepack pnpm typecheck`
- `corepack pnpm --dir apps/desktop test:smoke`
- `corepack pnpm test:three-peer-audio`
- `corepack pnpm dist:win`
