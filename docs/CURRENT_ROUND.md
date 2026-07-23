# ShangHao 2.0 release checkpoint

Updated: 2026-07-23

## Release scope

ShangHao 2.0 is the first animation-focused major release. It keeps the fixed-server Windows
architecture and concentrates on reliable five-person voice, direct-media screen sharing,
interruptible character movement, readable glass materials, and consistent nonlinear motion.

## Included

- Shared remote audio mixer for all remote members.
- Bidirectional late-join audio-path verification for the fourth and fifth members.
- Selective signaling-audio fallback that stops after a playable WebRTC track is confirmed.
- Eight-frame character run cycles, left-edge entry, shortest collision-safe routes, and
  interruptible seat changes.
- Direct-media detached screen viewer with self-window filtering.
- 720p and 1080p screen-share presets with system-audio support.
- RNNoise, low-cut filtering, voice EQ, 32 kHz audio, FEC/DTX, and weak-network adaptation.
- Readable glacier glass, unified motion tokens, animated controls, deduplicated toasts, and
  delayed reconnect overlays.
- Fixed-server-only client flow; no direct-host or Tailscale product paths.

## Release verification

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm test:five-peer-audio`
- `corepack pnpm build`
- `corepack pnpm dist:win`
- `corepack pnpm release:verify-package`

Real-device acceptance remains required for every future release: two independent Windows PCs,
then a three-to-five-person room, reconnect, audio-device switching, and screen sharing.

## Repository boundary

The release workspace contains only `apps/desktop` and `packages/*`. Local Windows repair tools,
experimental pet projects, generated visual-debug captures, and superseded character export
candidates are intentionally excluded from Git and the pnpm workspace.
