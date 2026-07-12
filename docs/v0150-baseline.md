# ShangHao v0.1.50 baseline

## Verified on 2026-07-11

| Check                              | Result                             |
| ---------------------------------- | ---------------------------------- |
| Workspace install                  | Passed with the lockfile unchanged |
| TypeScript project references      | Passed in all six packages         |
| Desktop smoke suite                | 60 of 60 passed                    |
| Three-peer audio route test        | Passed                             |
| WebSocket audio fallback           | Passed                             |
| Working tree before implementation | Clean at `v0.1.49`                 |

## Confirmed gaps

| Area             | Baseline behavior                                              | Required v0.1.50 behavior                                           |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Identity         | Several signaling messages trust client `peerId` and nickname  | Socket session is authoritative after join                          |
| Validation       | Any object containing `type` is accepted                       | Strict per-message validation with size/rate limits                 |
| Chat             | Client-authored metadata, cleared on channel entry, no history | Server-authored metadata and latest 100 persisted                   |
| Away             | Five minutes without speaking                                  | Thirty minutes of OS idle time                                      |
| Audio state      | Mute and deafen are independent toggles                        | Deafen atomically mutes and blocks every capture path               |
| Noise processing | Browser constraints, gate, and one low-cut biquad              | Auditable RNNoise path with fallback and fourth-order low cut       |
| Legacy features  | AI proxy, room note, custom status, random nickname remain     | Removed from code, protocol, settings, tests, docs, and environment |
| Electron         | Broad media permission and shared overlay preload              | App-origin permission policy and least-privilege overlay bridge     |
| Visual system    | Mixed easing/durations and heavy blur                          | One semantic motion/material system with accessibility fallbacks    |

## Release rule

No intermediate tag or package will be published. All work is delivered as one verified `v0.1.50` Windows release.
