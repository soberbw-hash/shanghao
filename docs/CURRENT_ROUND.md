# ShangHao 2.3 release checkpoint

Updated: 2026-08-02

## Release scope

ShangHao 2.3 keeps the fixed-server Windows architecture and concentrates on verified
five-person voice, DeepFilterNet readiness, direct-media screen sharing, interruptible
character movement, readable glass materials, and consistent nonlinear motion.

## Included

- Shared remote audio mixer for all remote members.
- Bidirectional late-join audio-path verification for the fourth and fifth members.
- Selective signaling-audio fallback that stops after a playable WebRTC track is confirmed.
- Eight-frame character run cycles, left-edge entry, shortest collision-safe routes, and
  interruptible seat changes.
- Direct-media detached screen viewer with self-window filtering.
- Fixed 1440p screen sharing with a per-share system-audio choice.
- One local DeepFilterNet denoiser, 48 kHz microphone processing, low-cut filtering, voice EQ,
  FEC/DTX, and weak-network adaptation. If the model is unavailable, the microphone stays on
  raw passthrough instead of switching to a second denoiser.
- Five isolated Electron clients verify all 20 directed WebRTC RTP flows, late join, and
  bidirectional pair recovery.
- Readable glacier glass, unified motion tokens, animated controls, deduplicated toasts, and
  delayed reconnect overlays.
- Fixed-server-only client flow; no direct-host or Tailscale product paths.
- Home-page microphone and speaker selection with real device readiness checks before joining.
- Persistent per-room collection for short text, links, and image references.
- Vertical compact overlay with per-member speaking and muted states.

## Release verification

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm test:audio-worklet`
- `corepack pnpm test:five-peer-audio`
- `corepack pnpm test:five-peer-media`
- `corepack pnpm build`
- `corepack pnpm dist:win`
- `corepack pnpm release:verify-package`

Real-device acceptance remains required for every future release: two independent Windows PCs,
then a three-to-five-person room, reconnect, audio-device switching, and screen sharing.

## Repository boundary

The release workspace contains only `apps/desktop` and `packages/*`. Local Windows repair tools,
experimental pet projects, generated visual-debug captures, and superseded character export
candidates are intentionally excluded from Git and the pnpm workspace.
