# ShangHao active work log

Updated: 2026-06-13

## Current objective

Implement the requirements from `C:\Users\sober\Desktop\文字.txt` in P0 -> P1 -> P2 -> P3 order.

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

## Intentionally untouched

- `enable-low-latency-profile.ps1`
- `gaming-optimize-admin.ps1`
- `run-low-latency-profile-admin.cmd`
