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

## 2026-08-11 Glass Hierarchy And Room Controls Refinement

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-d96a561f-10bd-4b5f-be60-230360af3323.png`
- Focused implementation: `C:/Users/sober/Documents/New project/design-qa-implementation.png`
- Side-by-side comparison: `C:/Users/sober/Documents/New project/design-qa-comparison.png`
- Full room: `C:/Users/sober/Documents/New project/design-qa-room.png`
- Collection state: `C:/Users/sober/Documents/New project/design-qa-collection.png`
- Settings update state: `C:/Users/sober/Documents/New project/design-qa-settings.png`
- Viewport: 1432 x 960 CSS pixels at device scale factor 1.5.
- Focused source and implementation: 523 x 591 pixels. The implementation clip was captured at the matching CSS size and device density before comparison.
- State: connected room with microphone controls open; collection and settings were captured as additional interaction states.

### Full-view comparison evidence

The room keeps the existing five-seat art and clear chat content while the window frame, top bar, dock, and transient controls share one restrained blue-white glass hierarchy. Large content regions remain nearly opaque, avoiding nested blur and preserving text contrast.

### Focused region comparison evidence

The side-by-side microphone comparison verifies the requested ordering: noise suppression, automatic gain, device selection, volume slider, then reset. The popover uses a 9px blur, 64% translucent surface, integer-pixel text, and no final transform. The device selector and slider remain fully visible above the dock.

### Findings and comparison history

- [P2 fixed] The reference showed device selection above processing controls. It now sits below noise suppression and automatic gain, with the volume slider kept at the bottom of the adjustable content.
- [P2 fixed] The per-member volume popover could appear under the character. It now always renders above the head with a measured 12px gap.
- [P2 fixed] A remote favicon request was blocked by the renderer CSP. The link preview now uses the bundled Lucide link icon, a shortened visible URL, and no external image request.
- [P2 fixed] The Apple Music glyph was an approximation. It now uses the official 64px Microsoft Store Apple Music application asset copied from the installed package.
- [P2 fixed] Collection copy and settings helper copy were overly verbose. The requested sentences are absent, the collection layout is shorter, and update rows say `查看详细信息`.

### Required fidelity surfaces

- Fonts and typography: 13px/700 primary and 11px/600 supporting text remain crisp; focused popovers finish with `transform: none`.
- Spacing and layout rhythm: the three material tiers maintain separate floating, toolbar/modal, and content layers; the microphone popup and dock meet without hiding controls.
- Colors and visual tokens: the existing white, glacier-blue, and mint direction is retained with one blue interaction accent.
- Image quality and assets: the Apple Music badge uses the official square rounded PNG; existing character, workstation, and image-message assets are unchanged.
- Copy and content: collection labels, shortcut helper text, update action text, and compact link labels match the requested wording.

### Interactions and runtime checks

- Opened and closed microphone controls, remote-member volume controls, collection, settings, and the update section.
- Confirmed a live chat URL renders as a compact link plus preview card and still opens through the existing system-browser handler.
- Confirmed no new console errors after clearing earlier development-log history.
- No actionable P0, P1, or P2 findings remain. No focused-region mismatch requires another iteration.

final result: passed

## 2026-08-12 Recording Library And Final Room Regression

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-c014fd43-10cf-452a-b814-a84af0f1945b.png`
- Rendered room: `C:/Users/sober/Documents/New project/design-qa-final-room-20260812.png`
- Rendered recording library: `C:/Users/sober/Documents/New project/design-qa-recording-library-20260812.png`
- Combined comparison: `C:/Users/sober/Documents/New project/design-qa-final-comparison-20260812.png`
- Viewport: 1448 x 984 CSS pixels at Windows device scale factor 1.5.
- Source pixels: 2168 x 1463. Room implementation pixels: 2172 x 1476. Recording library pixels: 2172 x 1475. The combined canvas keeps both room frames at native density and records the four-pixel source-width difference instead of treating it as layout drift.
- State: fixed one-room channel, one seated local member, Apple Music active, automatic recording active, restored chat history; separate recording-library state with 12 real local recordings.

### Full-view comparison evidence

The combined room image shows the requested cold-white and glacier-blue palette without the old dashed grid. The implementation increases workstation scale and lowers the five-desk group slightly while preserving the 3 + 2 structure. The seated character now meets the front edge of the desk, the identity label remains entirely below the character, and the current-seat fill is lighter than the source. Chat, top bar, and dock retain their original proportions and direct-access controls.

### Focused region comparison evidence

The recording-library capture verifies the same low-saturation glass hierarchy on a new settings surface. It shows the saved directory, 5 GB quota, selected recording, custom progress track and thumb, playback rate, next item, delete action, and the real local list. The earlier browser-default black range track is absent. A focused crop was not required because all player labels and controls are legible at the native 2172-pixel capture width.

### Findings and comparison history

- [P1 fixed] The recording-library renderer bridge existed while the running Electron main process still used an older IPC table, so the page reported `No handler registered for recording:list`. A full main-process rebuild/restart loaded the handler; the runtime then listed 12 recordings and successfully loaded metadata from a `shanghao-recording://` media URL.
- [P1 fixed] An additive daily-room request sent to the deployed 2.5 server returned `invalid_payload`, and the client treated that reply as a fatal room failure. New daily requests are now gated by server build, and an additive `invalid_payload` after a successful join is nonfatal, leaving chat and quick messages enabled.
- [P1 fixed] Voice activity updates could retrigger a whole-member scene effect and republish a stale destination. The effect now depends only on primitive scene, activity, game, music, and work values; a speaking-only update cannot change the selected seat.
- [P2 fixed] The recording player initially used Chromium's black default range track. It now uses the same blue progress, pale neutral remainder, crisp thumb, focus ring, and marker layering as the app's volume controls.
- [P2 fixed] Visual capture inherited the workstation's real 30-minute system idle value and moved the test character to `离开`. Capture-only IPC now reports zero idle time, producing a deterministic seated room without changing production auto-away behavior.
- [P3 accepted] The source member sits at workstation 5 while the deterministic implementation capture uses workstation 1. The character-to-desk scale, label gap, selected-area material, and workstation geometry are equivalent, so the different occupied seat does not mask a layout issue.

### Required fidelity surfaces

- Fonts and typography: Noto Sans SC/system fallbacks, integer font sizes, tabular numeric values, and crisp non-blurred content surfaces remain consistent; labels are vertically centered.
- Spacing and layout rhythm: workstations fill more of the room without changing the five-seat layout; the seated character and label use a consistent vertical relationship; settings rows and player controls align to the existing grid.
- Colors and visual tokens: cold white, pale glacier blue, healthy green, active blue, and record/destructive red retain one semantic mapping; no new heavy gradient or dark surface was introduced.
- Image quality and assets: the existing character/workstation art and official Apple Music rounded-square asset remain sharp and unmodified; detected applications use their real Windows executable icon.
- Copy and content: chat, quick replies, recording controls, update details, and room-history language stay concise and user-facing; open-source terms remain in repository documentation, not in the application UI.

### Runtime and interaction checks

- Fresh Electron main and renderer loaded without an error boundary after the required restart.
- Recording IPC returned 12 real items; custom-protocol audio reached `loadedmetadata` with a valid duration.
- Chat input was enabled and quick-message buttons were enabled after joining the deployed legacy server.
- The room capture entered and settled at workstation 1 without auto-away; speaking-state regression tests preserve every selected seat.
- Typecheck and the focused React ESLint review passed after converting effect dependencies to primitive values and a stable latest-callback ref.

final result: passed

## 2026-08-11 Invitation, Room Geometry, And Interaction Consistency

- Source visual truth:
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-5c02a5b8-0462-4cce-b88a-a4b98c1caa84.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-4f13c7fd-ae5f-4f8e-b2cc-a744bf8ec877.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-05d64591-1883-4db7-a087-2b56c9278683.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-4cd2c954-0df1-4720-b183-e5a99bed207d.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-2118e8b8-1fdd-45cb-93b7-9e43bf294193.png`
- Implementation screenshot: `C:/Users/sober/Documents/New project/design-qa-room-layout-final.png`
- Side-by-side comparison: `C:/Users/sober/Documents/New project/design-qa-invite-room-comparison.png`
- Source room screenshot: 2159 x 1448 pixels; implementation: 2172 x 1464 pixels at approximately 1448 x 976 CSS pixels and device scale factor 1.5. Both sides were normalized to 960 pixels wide in the 1920 x 647 comparison canvas.
- State: connected room, four members represented in chat, one local member rendered at workstation 5, no active screen share, dock visible.

### Full-view and focused comparison evidence

The combined canvas places the user's workstation-spacing reference on the left and the running Electron room on the right. The revised scene keeps the five-workstation composition while moving seated characters close enough for the head to meet the desk edge, keeping the identity label entirely below the character, and removing the connected-state subtitle that previously read `频道空闲中`. The bottom dock retains semantic color for mute, recording, overlay, and exit while sharing one height, radius, hover elevation, and pressed response.

Focused inspection covered the top-left connection copy, member identity and latency label, workstation-to-character distance, Apple Music/Spotify badge sizing, and the complete dock action row. No focused asset crop was needed because the source and implementation show these regions at readable full-window scale.

### Findings and comparison history

- [P1 fixed] Copied invitations were plain text and could not launch the client. Invitations now use a validated `shanghao://join` deep link; the main process registers the protocol, supports cold start and second-instance delivery, and the renderer saves the supplied fixed server before entering the requested room.
- [P2 fixed] `频道空闲中` appeared to describe room activity even while members were connected. The connected state now has no redundant subtitle; reconnecting, opening, and failure states remain visible.
- [P2 fixed] Member labels covered different parts of upper and lower characters and the speaking surface exposed body pixels through a very transparent fill. Every seated label now follows the character with one consistent gap, remains below the body, and uses a readable frosted speaking surface.
- [P2 fixed] Characters sat visibly far away from their desks. All five seated anchors were moved upward and normalized to the same scale so heads lightly meet the workstation edge without hiding labels.
- [P2 fixed] Latency reacted to every small sample and could repeatedly fall back to `--`. Invalid samples now retain the last valid value, valid values are smoothed, small changes are ignored, and the initial label reads `测量中` instead of dashes.
- [P2 fixed] Action buttons used unrelated hover shadows and pressed effects. The recording interaction is now the shared motion and elevation baseline, with semantic tint retained for recording, overlay, and exit.
- [P2 fixed] A channel switch could leave an interrupted character route mounted. The room scene is keyed by room id, so switching cancels the outgoing scene and starts the incoming scene from a clean entrance state.
- [P3 fixed] The `小惊喜` donation kicker and the redundant mic/speaker glyph after each member name were removed.
- [P3 fixed] Spotify was optically smaller than Apple Music. Provider-specific glyph sizing now keeps both music badges visually balanced inside the same activity container.

### Required fidelity surfaces

- Fonts and typography: the Noto Sans SC family, integer font sizes, stable optical weights, and tabular latency figures are retained; labels no longer depend on translucent text rendering.
- Spacing and layout rhythm: member labels no longer cover the body, seated anchors share one vertical relationship to desks, and the dock uses a consistent control rhythm.
- Colors and visual tokens: action states keep their established blue, red, and green semantics while sharing the same shadow and hover tokens.
- Image quality and assets: the official provider assets and existing character/workstation images remain unchanged; no replacement illustrations or generated icons were introduced.
- Copy and content: connected-state filler and donation kicker copy were removed; latency fallback and invitation feedback are concise and task-specific.
- Accessibility and interactions: labels retain readable contrast; protocol input is validated to ws/wss and known room ids; button hover and pressed states remain keyboard-compatible through existing button elements.

### Runtime and automated checks

- Opened the source references, the running room capture, and the normalized side-by-side comparison.
- Verified the development protocol registration path and corrected command-line flag handling before handoff.
- Typecheck passed; 174 smoke tests passed.
- AudioWorklet smoke passed at 48 kHz.
- Five-peer audio passed all 20 directed routes, late join/reconnect, and relay fallback.
- Five-peer media passed all 20 directed flows and recovery of the A-E pair.
- Production build passed.

final result: passed

## 2026-08-11 Persistent Chat, Toast Alignment, And Room Spacing Pass

- Source visual truth:
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-dd50f76e-d8e5-4bc3-9000-21cc985c6d21.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-420cbc6f-eae9-42b9-b952-449eaac0f0a5.png`
- Implementation screenshots:
  - `C:/Users/sober/Documents/New project/design-qa-toast.png`
  - `C:/Users/sober/Documents/New project/design-qa-final-room.png`
  - `C:/Users/sober/Documents/New project/design-qa-final-controls.png`
- Side-by-side comparison evidence:
  - `C:/Users/sober/Documents/New project/design-qa-update-toast-comparison.png`
  - `C:/Users/sober/Documents/New project/design-qa-update-room-comparison.png`
- Viewport: 1440 x 968 CSS pixels at device scale factor 1.5.
- Source room pixels: 2156 x 1448. Implementation room pixels: 2160 x 1452. Both were normalized to 1080 x 726 in the combined comparison.
- Source toast pixels: 639 x 141. The implementation toast was cropped to the same 640 x 141 focused region before comparison.
- State: connected four-person room, chat populated, no active screen share; separate microphone and remote-member volume-control checks.

### Full-view and focused comparison evidence

The room comparison shows that the scene, dock, chat proportions, character scale, and workstation art remain unchanged. The upper-row identity labels are lifted within their existing anchors; measured label bottoms now remain above the lower monitor tops instead of entering the screen area. The toast comparison shows the icon and single-line copy sharing the same vertical center, with no backdrop-filter applied to the text layer.

### Findings and comparison history

- [P1 fixed] Chat content depended only on the current renderer/server snapshot and could appear lost after a desktop update. A versioned per-server, per-room cache now lives under Electron `userData`, keeps up to 500 recent messages within a size budget, restores before server synchronization, and persists recalls as well as new messages.
- [P1 fixed] New remote chat messages did not all reach Windows notifications. Every live remote text, link, or image message now uses the existing native notification bridge; restored history does not replay notifications.
- [P2 fixed] Toast text was vertically high and visually soft. The card now has a fixed 56px minimum row, centered icon/copy, explicit line height, no final-state scale animation, and no blur on the content-bearing surface.
- [P2 fixed] Volume controls had no reliable 100% reference. Microphone, master speaker, and per-member sliders now render a default node and snap gently to it while dragging.
- [P2 fixed] Upper-row member labels entered the lower workstation screen area. Their row-specific offset is reduced, label width is capped, and runtime geometry shows a positive vertical gap without moving workstations or changing character routes.
- [P3 fixed] A larger local chat cache could make long conversations expensive to render. Chat rows now use `content-visibility` with an intrinsic height while preserving the existing scroll layout.

### Required fidelity surfaces

- Fonts and typography: Noto Sans SC remains unchanged; toast scaling and blur were removed, line height is explicit, and tabular volume values remain stable.
- Spacing and layout rhythm: the original room geometry remains intact; only the upper-row label offset and maximum width changed.
- Colors and visual tokens: existing blue-white glass tokens remain; the toast surface is near-opaque so text stays crisp.
- Image quality and assets: character, workstation, Apple Music, and link-preview assets are unchanged.
- Copy and content: notification copy is concise and message-specific; restored chat content remains separated by fixed server and channel.

### Interactions and runtime checks

- Triggered a real link-copy toast and confirmed a 56px card, centered alignment, and `backdrop-filter: none`.
- Opened a remote member volume control and confirmed the 100% reference node is present in the 0–300% slider.
- Opened the microphone panel with a real pointer event and confirmed its 100% reference node is present.
- Restarted the development Electron main process and confirmed the new history bridge exists, 19 chat rows restore, and no error boundary is active.
- Confirmed the user-data history file was written with 20 messages for the active room.
- Automated checks passed: typecheck, 170/170 smoke tests, 48 kHz audio-worklet, 20/20 five-peer audio routes, 20/20 five-peer media flows with late-join recovery, and full build.

final result: passed

## 2026-08-11 Room State And Glass Consistency Regression Pass

- Source visual truth: `C:/Users/sober/AppData/Local/Temp/codex-clipboard-e1dee611-79c5-4e79-8a72-cd9993bce112.png`
- Implementation screenshot: `C:/Users/sober/Documents/New project/design-qa-glass-room.png`
- Side-by-side comparison: `C:/Users/sober/Documents/New project/design-qa-latest-comparison.png`
- Viewport: 1440 x 968 CSS pixels at device scale factor 1.5.
- Source pixels: 2144 x 1436. Implementation pixels: 2160 x 1452. The comparison preserves each full frame without resampling; the small source-size difference is recorded rather than treated as layout drift.
- State: connected four-person room with Apple Music tooltip and a remote-member volume control visible; no active screen share.

### Full-view and focused comparison evidence

The combined image compares the supplied room reference and the running Electron app in one canvas. The room geometry, chat column, dock, official Apple Music icon, music tooltip, and compact member-volume control remain visually aligned. The implementation carries the same translucent blue-white material into music, volume, link-preview, toast, and screen-share floating surfaces without adding blur to the room art or chat text.

### Findings and comparison history

- [P1 fixed] A newly negotiated placeholder video track could render the screen-share panel before any member announced a real share. Screen video and fallback frames now require an explicit current-room `screen_share_state`, and that state is cleared on room switch, peer leave, and disconnect.
- [P1 fixed] Local voice activity was sent to signaling but not written into the local member immediately; mute/deafen changes could also overwrite a live speaking state with silence. The detector now updates the local member and signaling from the same state transition, so the room and overlay consume one synchronized value.
- [P1 fixed] The captured error screen came from a development HMR/preload capability mismatch. Link icon loading now checks that the bridge method exists before calling it, so an older preload falls back instead of crashing the room.
- [P2 fixed] Collection text could be resized and break the modal layout. Its resize mode is now fixed to `none`.
- [P2 fixed] Link previews lacked a direct copy gesture. Right-click now writes the complete URL to the Electron clipboard immediately and shows `已复制链接`.
- [P2 fixed] Microphone and speaker controls used different custom stroke constructions. Both primary controls now use matching Lucide 17px icons, identical stroke weight, and the same label weight.
- [P2 fixed] Floating surfaces had inconsistent opacity and blur. Member volume, music tooltip, toast, link preview, and screen-share panel now share the same bounded frosted material token.

### Required fidelity surfaces

- Fonts and typography: primary audio labels share one 650 optical weight; popup text remains at integer sizes without final-state scaling.
- Spacing and layout rhythm: no transient screen-share panel is present in the no-share capture; both visible popovers remain attached to their member context and avoid persistent controls.
- Colors and visual tokens: floating surfaces use one 12px blur and restrained blue-white translucency; content surfaces remain opaque enough for legibility.
- Image quality and assets: the official Apple Music PNG and all room characters/workstations are unchanged and remain crisp.
- Copy and content: the link copy toast is the requested concise `已复制链接`; collection and audio controls add no explanatory clutter.

### Runtime checks

- Confirmed the running room has zero screen-share panels when no share is announced.
- Opened collection and confirmed computed `resize: none`.
- Right-clicked a real link preview and observed the success toast without confirmation UI.
- Opened member volume and Apple Music tooltip together and captured the rendered state.
- Confirmed the current renderer has no error boundary and the link-preview capability guard is active.
- Automated checks passed: 166 smoke tests, typecheck, 20/20 five-peer audio routes, and 20/20 five-peer media flows including late-join recovery.

final result: passed

## 2026-08-11 Link, Member Volume, And Microphone Frosting Refinement

- Source visual truth:
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-acfabbdd-a3ad-4714-b215-1a0c464c31de.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-077bb24f-32f2-466c-b37e-fe399c881eea.png`
  - `C:/Users/sober/AppData/Local/Temp/codex-clipboard-c024f5ff-5dce-48b9-89fe-6a84482e3653.png`
- Implementation screenshot: `C:/Users/sober/Documents/New project/apps/desktop/design-qa-latest-room.png`
- Side-by-side comparison: `C:/Users/sober/Documents/New project/design-qa-latest-comparison.png`
- Source room screenshot: 2144 x 1436 pixels.
- Implementation: 1440 x 968 CSS pixels, captured at device scale factor 1.5 as 2160 x 1452 pixels.
- State: connected room with a remote-member volume control, microphone settings, Apple Music activity, and live link previews visible.

### Full-view comparison evidence

The latest comparison keeps the original room composition and dock while reducing the Apple Music badge, removing the duplicate URL bubble, replacing the generic link glyph with a real site icon, and moving the member volume control out of the workstation screen area.

### Focused region comparison evidence

The member-volume control now replaces the clicked member's existing identity label instead of opening above the head. It keeps one mute button, one 0–300% slider, and one numeric value in the same compact footprint. The microphone panel uses a 22px backdrop blur and 98.5% surface opacity; its processing rows use the same 98.5% white surface, so the underlying `离开` label is no longer legible.

### Findings and comparison history

- [P2 fixed] A URL-only message rendered both a URL bubble and a preview card. URL-only messages now render only the preview card; mixed text-and-link messages keep their written context.
- [P2 fixed] The link card used a generic link glyph. It now requests a constrained favicon through the Electron main process, caps the response at 256 KB, caches it locally, and sends a data URL to the renderer. Failed requests fall back to the existing link icon.
- [P2 fixed] The volume control above a character obscured a workstation, while side placement could overlap another friend. The final control replaces the clicked member label in place, and the old label fades out while the control is open.
- [P2 fixed] The microphone glass allowed the scene's `离开` label to remain visible. The dedicated microphone surface and processing rows are now sufficiently opaque while retaining a visible frosted edge and blur.
- [P3 fixed] The official Apple Music badge measured 30px. It now measures 26px and retains its official square-rounded asset.

### Required fidelity surfaces

- Fonts and typography: existing Noto Sans SC hierarchy is unchanged; numeric volume labels use stable tabular figures.
- Spacing and layout rhythm: the volume control occupies the former label footprint and does not add a new panel above a monitor.
- Colors and visual tokens: the restrained blue-white material system is retained; only the microphone panel opacity was raised for legibility.
- Image quality and assets: Apple Music still uses the official Microsoft Store PNG; link cards display a 30px site image where available.
- Copy and content: URL-only messages no longer repeat the same address; preview cards keep the hostname and one concise action label.

### Interactions and runtime checks

- Opened the remote-member volume control and microphone panel in the running Electron development app.
- Confirmed the hidden member label reaches opacity 0 while its control is open.
- Confirmed the link preview receives a `data:image/png` source and no duplicate message bubble is present.
- Confirmed Apple Music renders at 26 x 26 CSS pixels.
- Cleared and checked the Electron renderer log; no new console errors were observed.

final result: passed
