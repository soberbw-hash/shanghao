# ShangHao Room Scene Design QA

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-b1b64618-3d98-47fc-8527-1af2c662d5ed.png`
- Implementation screenshot: `C:/Users/sober/Documents/New project/tmp/visual-qa/room-seat.png`
- Screen-share screenshot: `C:/Users/sober/Documents/New project/tmp/visual-qa/screen-share.png`
- Full comparison: `C:/Users/sober/Documents/New project/tmp/visual-qa/comparison.png`
- Viewport: 1280 x 800 CSS pixels, captured at Windows 150% DPI as 1920 x 1200
- State: connected fixed channel, local member moved from seat 1 to seat 2

## Full-view comparison evidence

The implementation follows the source's key workstation posture: a flat rear-view character sits between the monitor and a foreground chair. The five workstations use a regular 3 + 2 layout with one separate away zone, replacing the previous scattered scene.

## Focused region comparison evidence

The seat-switch capture confirms that seat 2 receives the active outline, monitor state, character, and status label after clicking. The screen-share capture confirms that the Electron desktop source is captured and rendered in the in-room preview panel.

## Findings

- No actionable P0, P1, or P2 mismatch remains for this scope.
- Typography keeps the existing ShangHao system-font hierarchy and remains legible at the captured DPI.
- Spacing is intentionally more open than the narrow Marvis reference so five friends remain scannable in one desktop scene.
- Existing white and blue tokens remain consistent with the approved application style.
- Rear-view character assets are crisp alpha PNGs without visible chroma fringe at room scale.
- App-specific copy is reduced to seat numbers, status, and the single `离开` area as requested.

## Patches made

- Removed the redundant office title and nonessential activity zones.
- Replaced seated front-view composites with five generated rear-view workstation characters.
- Raised clickable seat hotspots above scene characters and blocked occupied seats.
- Added Electron display-media approval and verified a real desktop frame.
- Removed the transparent overlay window's outer shadow margin.

## Follow-up polish

- P3: A future source picker can let users choose a specific window instead of defaulting to the primary display.

final result: passed
