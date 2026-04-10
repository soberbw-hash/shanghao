# Private Voice App Architecture

This repository is a Windows-first desktop voice app for 3-5 fixed friends.

Core principles:

- Electron owns native responsibilities: tray, file system, logging, global shortcuts, Tailscale checks, recording export.
- React renderer owns UI, room state, WebRTC orchestration, device switching, and recording controls.
- A tiny `ws` signaling server is started by the host inside the desktop app.
- WebRTC uses an audio-only P2P mesh for small rooms.
- Recording is manual-only and always goes through an export pipeline that targets AAC in an `.m4a` container.

Package boundaries:

- `apps/desktop`: Electron shell, preload bridge, React renderer.
- `packages/shared`: enums, domain types, constants, app contracts.
- `packages/signaling`: room manager and WebSocket signaling server.
- `packages/webrtc`: audio constraints, peer lifecycle, speaking detection, reconnection helpers.
- `packages/recording`: recording state machine, MIME capability detection, encoder/export abstractions.
- `packages/ui`: shared design tokens and primitive UI components.
