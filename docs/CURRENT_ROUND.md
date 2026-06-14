# ShangHao current round checkpoint

Updated: 2026-06-15

## Objective

Continue refining the existing ShangHao desktop app without changing the voice connection architecture.

The source brief is `C:\Users\sober\Desktop\优化方案.txt`.

## Baseline already completed

- White miniature office scene is integrated.
- Five character identities are migrated to fox, cat, duck, panda, and corgi.
- The entry page uses a locally saved server address.
- The room page contains lightweight chat, recording, device controls, and a real Electron overlay window.
- `knock_event` is a dedicated signaling event with a five-second client cooldown.
- Settings are already reduced to everyday controls.
- Verification before this round:
  - `corepack pnpm typecheck`: passed.
  - `corepack pnpm --dir apps/desktop test:smoke`: passed, 54 tests.
  - `corepack pnpm test:three-peer-audio`: passed.
  - `corepack pnpm dist:win`: passed.

## This round checklist

- [x] Replace scene avatar cards with transparent character sprites and no white UI container.
- [x] Remove character scaling/bouncing and move speaking feedback onto the character.
- [x] Remove the footer green audio meter.
- [x] Add speaker-off/deafen state, local audio behavior, signaling sync, and character icon.
- [x] Add eight percentage-based clickable scene zones.
- [x] Add local Windows detection for Delta Force and League of Legends.
- [x] Add simple activity/zone state and slow random idle assignment.
- [x] Enforce unique visible avatar identities.
- [x] Improve scene cover/cropping while keeping zones aligned.
- [x] Change entry copy from avatar selection to character selection and remove character cards.
- [x] Remove recording from Settings.
- [x] Redesign overlay into a tiny left-side speaking avatar widget without a close button.
- [x] Add generated short sound assets and centralized playback for all required actions.
- [x] Expand quick replies to include 上号, 开麦, 等我, 来了, and 冲.
- [x] Add or update smoke tests for these behaviors.
- [x] Run typecheck, smoke tests, three-peer audio verification, and Windows packaging.

## Save strategy

- Update this file after each completed feature group.
- Create local Git checkpoint commits before risky or broad changes.
- Do not stage or modify these unrelated local scripts:
  - `enable-low-latency-profile.ps1`
  - `gaming-optimize-admin.ps1`
  - `run-low-latency-profile-admin.cmd`

## Checkpoint 2026-06-15 / scene presence

- Added transparent scene-specific character assets.
- Added synchronized deafen, activity, scene zone, and game name member fields.
- Added eight clickable percentage-positioned room zones.
- Replaced the large overlay panel with a 72x76 left-side speaking character widget.
- Removed the room audio meter and the Settings recording section.
- Verification: `corepack pnpm typecheck` passed.

## Checkpoint 2026-06-15 / activity and feedback

- Added a privacy-bounded Windows game detector that polls every four seconds and emits only known friendly game names.
- Added detected-game activity, user-selected scene movement, and slow natural idle movement.
- Added 16 generated low-volume WAV feedback assets and a single centralized playback manager.
- Added regression coverage for scene/deafen synchronization, game matching, sound assets, overlay size, and simplified Settings.
- Verification: `corepack pnpm --dir apps/desktop test:smoke` passed, 57 tests.

## Final verification

- `corepack pnpm typecheck`: passed.
- `corepack pnpm --dir apps/desktop test:smoke`: passed, 57 tests.
- `corepack pnpm test:three-peer-audio`: passed with no missing audio routes.
- `corepack pnpm dist:win`: passed.
- Packaged scene screenshot: `artifacts/current-round-room.png`.
- Installer: `apps/desktop/release/ShangHao-0.1.26-Setup-x64.exe`.
