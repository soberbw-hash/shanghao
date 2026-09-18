# Room visual follow-up — 2026-09-18

## Implemented

- Calendar: generated blank dimensional face; live date text no longer sits on an opaque white rectangle.
- Local account identity: account display name and uploaded/preset portrait are preserved when room members refresh. Remote member identity is not overwritten with local settings.
- Workstations: lighting filter applies to furniture image, not live screen; screen bounds expanded slightly to cover the previous thin dark seam. Hover keeps the same filter separation.
- Seat numbers render below characters. Only the hovered seat reveals its marker.
- Chat settings moved to the title row, right aligned with an inset.
- Curtain is an independent ceiling-height layer; foreground leaves overlay the door corner.
- Five matching weather landscapes integrated with existing cloud/rain/snow/fog/lightning effects, visibility and reduced-motion controls.

## Verification

- Desktop TypeScript check: passed.
- Desktop smoke suite: 591 passed, 0 failed (includes five new follow-up regression tests and character-label/avatar separation coverage).
- Renderer production build: passed.
- git diff --check: passed.
- Local browser fixture: inspected calendar, curtain, foreground overlap, seat 4 and 5 live screens, character/number depth, chat title alignment and settings callback.
- Snow animation confirmed by separate DOM observations: first three snowflakes moved from y=282.85/294.48/306.10 to y=323.53/335.15/346.78.
- Fixture mirrors app focus class so production visual-pause CSS works correctly. Hidden/reduced-motion behavior retains existing controller/CSS and regression coverage; no live media lifecycle changed.

## Boundaries

Latest avatar clarification: character status labels contain no portrait; chat retains AccountAvatar. Local chat messages can resolve the current local account portrait/preset even when their old connection peer ID no longer matches. New local messages also retain an avatarUrl snapshot. Historical messages without a portrait or a reliable local/member identity still use initials; do not match accounts by nickname alone.

No packaging, release, push, server deployment, or version change. Real Electron floating-window account synchronization, remote-member avatar propagation, and real SMS/password change were not end-to-end tested in this visual fixture. Existing password reset form includes code/new-password/confirmation fields and its automated tests pass; no real credential was changed. Native PhoneAudio build was previously blocked by a running process locking its output, not by renderer compilation.

## Generated assets and prompts

Mode: built-in image generation/editing. Assets saved under `apps/desktop/src/renderer/src/assets/scenes/shanghao-room/`. Original assets retained.

- `calendar-blank-v2.png`: Edit supplied blue 3D calendar. Remove only raised crescent and fifteen dots. Reconstruct uninterrupted softly shaded blue-white ceramic/paper face, keeping dimensional gradients, not a flat white rectangle. Keep exact silhouette, rings, framing and proportions. No text or numbers. Transparent background.
- `window-frame-v2.png`: Keep exact supplied window geometry, rounded blue-white 3D frame, mullion and plants. Remove curtain. Replace both glass interiors, skyline, sky and bushes with transparent alpha holes. Preserve soft lighting; outside frame/plants transparent.
- `curtain-ceiling-v2.png`: Supplied window is style reference only. Isolated long icy-blue sheer curtain hangs from canvas top edge, gentle vertical folds, slightly gathered left, soft 3D cloth shading, narrow portrait 1:3, transparent background, organic bottom, no window/rod/plants.
- `foreground-leaves-v2.png`: Extract only blurry dark teal bottom-left foreground leaves from extended environment. Preserve entire canvas dimensions and positions; everything else transparent, soft out-of-focus alpha edges. Overlay will occlude door behind leaves.

Weather prompt template: Use supplied window as style reference only. Wide 2:1 outdoor view for a small game-room window, softly rounded clay-like 3D miniature city and trees; lower 40% buildings/foliage, upper 60% sky. No window frame, curtain, interior, border or text. Match soft blue material and peaceful look. Full bleed opaque image. Variants:

- `weather-day.png`: clear daytime, pastel azure sky, warm sunlight.
- `weather-cloudy.png`: overcast daytime, soft blue-gray clouds, gently muted trees.
- `weather-rain.png`: rainy storm sky, moody deep blue-gray city, warm lit windows, no rain streaks (animated separately).
- `weather-snow.png`: winter daytime, snow on rooftops and foliage, pale sky, no falling snow (animated separately).
- `weather-night.png`: clear moonlit night, deep blue sky, luminous moon upper right, subtle stars, warm building windows.
