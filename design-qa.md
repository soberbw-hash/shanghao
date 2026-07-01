# ShangHao Room And Liquid Glass Design QA

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-b1b64618-3d98-47fc-8527-1af2c662d5ed.png`
- Material guidance: `https://developer.apple.com/design/human-interface-guidelines/materials`
- Implementation screenshot: `C:/Users/sober/Documents/New project/tmp/visual-qa/room-liquid.png`
- Screen-share screenshot: `C:/Users/sober/Documents/New project/tmp/visual-qa/screen-share-small.png`
- Expanded screen-share screenshot: `C:/Users/sober/Documents/New project/tmp/visual-qa/screen-share-expanded.png`
- Settings screenshot: `C:/Users/sober/Documents/New project/tmp/visual-qa/settings-liquid.png`
- Viewport: 1280 x 800 CSS pixels, captured at Windows 150% DPI as 1920 x 1200
- State: connected fixed channel, local member in seat 1, local desktop sharing active

## Full-view comparison evidence

The implementation keeps the five-workstation 3 + 2 room layout and separates the larger `离开一下` area. Liquid Glass is concentrated on the window frame, navigation, controls, chat, and floating share surface while the scene remains a clear content layer.

## Focused region comparison evidence

The small-share capture confirms a compact floating preview with a visible drag affordance and expand control. The expanded capture confirms the share replaces the animal scene without covering chat or the voice dock, and can return through the minimize control.

## Findings

- No actionable P0, P1, or P2 mismatch remains for this scope.
- Typography keeps the existing ShangHao system-font hierarchy and remains legible at the captured DPI.
- Spacing is intentionally more open than the narrow Marvis reference so five friends remain scannable in one desktop scene.
- White, blue, and mint refraction tokens remain legible without turning content panels into opaque blur.
- Rear-view character assets are crisp alpha PNGs without visible chroma fringe at room scale.
- App-specific copy is reduced to seat numbers, status, and the single `离开一下` area as requested.

## Patches made

- Removed the redundant office title and nonessential activity zones.
- Replaced seated front-view composites with five generated rear-view workstation characters.
- Moved seat ownership to signaling-server arbitration so simultaneous clicks cannot overlap.
- Added pre-negotiated bidirectional screen video, muted autoplay, relay-frame fallback, drag, expand, and compact live feedback.
- Added 32 kHz defaults, five-band voice EQ, 80 Hz low cut, and a lightweight adaptive noise gate.
- Removed slider-triggered settings-page re-entry animation and per-step disk writes.
- Removed the transparent overlay window's outer shadow margin.

## Follow-up polish

- P3: A future source picker can let users choose a specific window instead of defaulting to the primary display.
- P3: A true two-machine visual regression harness can verify remote video pixels in CI; current coverage verifies real local capture, WebRTC wiring, and server frame relay separately.

final result: passed
