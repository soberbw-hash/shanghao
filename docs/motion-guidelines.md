# ShangHao motion guidelines

ShangHao uses one shared motion vocabulary. Durations, easing curves, and spring
settings are defined in `packages/shared/src/constants/motion.ts` and exposed to
the renderer through `features/motion/motionSystem.ts`.

## Ownership

- CSS owns hover, pointer-down, focus, color, border, small shadow, and simple
  icon-state feedback.
- Framer Motion owns mount/unmount, layout reconciliation, dialog and toast
  presence, list reflow, and local crossfades.
- GSAP owns orchestrated page entrances, room transitions, knock propagation,
  and multi-stage scene timelines.
- The character state machine owns stand, turn, walk/run, approach, sit, idle,
  leave, and interrupted rerouting.

## One transform owner

The same DOM element must never have `transform`, `opacity`, `filter`,
`clip-path`, `x/y`, `scale`, or `rotate` controlled by more than one engine.
When a sequence needs both layout motion and a local performance:

1. Framer Motion controls an outer layout wrapper.
2. GSAP or CSS controls a separate inner element.
3. The character state machine updates the route wrapper only.

Do not apply CSS transform animations to a Framer `motion.*` node that also
animates `x`, `y`, `scale`, or `rotate`.

## Tokens

- `instant` 100 ms: reduced-motion fallback and immediate state cleanup.
- `fast` 150 ms: color, icon, and pointer feedback.
- `compact` 200 ms: small overlays and popovers.
- `normal` 280 ms: messages, panels, and local state changes.
- `relaxed` 360 ms: page and large-panel transitions.
- `slow` 520 ms: deliberate spatial transitions.
- `scene` 650 ms: orchestrated scene entrance only.

Use `springSoft` for avatars and lightweight layout, `springCompact` for
switches and small overlays, and `springPhysical` for drag release, character
arrival, and screen-share window settling.

## Reduced motion

Reduced motion is a correctness mode, not a second design system. Preserve
visibility, state changes, and focus movement while replacing spatial travel
with short opacity transitions. Network operations must never wait for visual
animation, with or without reduced motion.

## Performance

- Animate compositor properties only.
- Avoid animating `backdrop-filter` and layout-affecting properties.
- Keep permanent `will-change` declarations off static elements.
- Preload character sprites before a route starts.
- Cancel or retarget in-flight character motion instead of queueing another
  route.
