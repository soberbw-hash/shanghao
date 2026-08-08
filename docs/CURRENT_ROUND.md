# ShangHao 2.4 local review checkpoint

Updated: 2026-08-08

## Scope

This local review build keeps the fixed-server Windows product and the verified five-person
audio topology. The round focuses on selective recovery, bandwidth discipline, Windows startup
and firewall reliability, TURN transport coverage, and a small set of daily-use controls.

## Audio invariants kept intact

- Five isolated Electron clients still verify all 20 directed WebRTC audio paths.
- Every remote member continues through one shared `RemoteAudioMixer`.
- RTP arrival alone is not considered success; decoded playable PCM remains the proof used to
  retire signaling-audio fallback.
- Late join, one-peer teardown, bidirectional recovery, unique seats, and stale-session cleanup
  remain release gates.

## New in this checkpoint

- Signaling-audio fallback is targeted per peer and only active while that peer lacks verified
  WebRTC playback or explicitly requests recovery.
- Relay voice activity uses an adaptive floor, pre-roll, hangover, and transient rejection so
  keyboard taps do not continuously consume server bandwidth.
- A failed peer receives an ICE restart before its peer connection is rebuilt.
- Production Windows builds request administrator privileges. Startup uses a delayed,
  current-user, highest-available scheduled task; application-scoped firewall rules are grouped
  under `ShangHao Network` and can be inspected or repaired from Settings.
- TURN deployment supports UDP/TCP and optional TLS transports. `/ice-config` returns temporary
  credentials without exposing the shared secret.
- Microphone send gain, speaker master gain, automatic room recording, collection unread state,
  overlay activity indicators, and idempotent screen-share cleanup are included.
- A manual 4 Mbps Linux acceptance script is available and never runs in production by itself.

## Local review gate

Run lint, typecheck, the complete desktop test suite, AudioWorklet smoke, five-peer signaling and
media tests, production build, Windows packaging, execution-level verification, and packaged
runtime verification. Real-device acceptance remains required before publishing: two independent
Windows PCs first, then four- and five-person rooms, device switching, network interruption,
screen sharing, and a one-hour voice session.

This checkpoint must remain local until the owner approves it. Do not push or create a release.
