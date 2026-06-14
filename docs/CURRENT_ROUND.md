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

- [ ] Replace scene avatar cards with transparent character sprites and no white UI container.
- [ ] Remove character scaling/bouncing and move speaking feedback onto the character.
- [ ] Remove the footer green audio meter.
- [ ] Add speaker-off/deafen state, local audio behavior, signaling sync, and character icon.
- [ ] Add eight percentage-based clickable scene zones.
- [ ] Add local Windows detection for Delta Force and League of Legends.
- [ ] Add simple activity/zone state and slow random idle assignment.
- [ ] Enforce unique visible avatar identities.
- [ ] Improve scene cover/cropping while keeping zones aligned.
- [ ] Change entry copy from avatar selection to character selection and remove character cards.
- [ ] Remove recording from Settings.
- [ ] Redesign overlay into a tiny left-side speaking avatar widget without a close button.
- [ ] Add generated short sound assets and centralized playback for all required actions.
- [ ] Expand quick replies to include 上号, 开麦, 等我, 来了, and 冲.
- [ ] Add or update smoke tests for these behaviors.
- [ ] Run typecheck, smoke tests, three-peer audio verification, and Windows packaging.

## Save strategy

- Update this file after each completed feature group.
- Create local Git checkpoint commits before risky or broad changes.
- Do not stage or modify these unrelated local scripts:
  - `enable-low-latency-profile.ps1`
  - `gaming-optimize-admin.ps1`
  - `run-low-latency-profile-admin.cmd`
