# ShangHao v0.1.50 design and motion audit

The audit uses the Apple Design Resources reference supplied by the product owner, Emil Kowalski's public design-engineering skills at commit `b57fc72f8415d84db1e9cfb43270466bf12ac6e2`, and the repository's installed GSAP and UI/UX review skills.

The generic UI/UX search recommended a dark purple liquid-glass theme and display fonts. That result is intentionally rejected: it conflicts with ShangHao's calm light desktop identity, Chinese readability, low-GPU gaming use, and the owner's existing approved direction.

| Path / surface          | Before                                                 | After                                                                   | Why                                              | Severity | Verification                                    |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------ | -------- | ----------------------------------------------- |
| Global typography       | Mixed small sizes and scattered weights                | System/Harmony stack with a small semantic type scale                   | Improves Chinese legibility and hierarchy        | P1       | 100% and 150% Windows scaling screenshots       |
| Global color            | Repeated literal blue/gray values                      | Semantic surface, text, border, accent, success, warning, danger tokens | Keeps state meaning consistent                   | P1       | Token search and contrast audit                 |
| Materials               | Many nested 20-32px backdrop blurs                     | Blur only on top-level glass surfaces; opaque fallback                  | Avoids competing with games for GPU              | P0       | GPU/process profiling and transparency override |
| Motion                  | GSAP, Framer, and CSS use unrelated curves             | Shared durations and three approved cubic-bezier curves                 | Creates one coherent physical language           | P1       | Reduced-motion and 60fps interaction check      |
| High-frequency controls | Visible back overshoot and long tails                  | Fast, critically damped press/release feedback                          | Feels responsive rather than decorative          | P1       | Keyboard/mouse repeated-toggle test             |
| Page entry              | Multiple staged animations and transient blank content | Content-first render with short opacity/transform continuity            | Removes the perceived join/settings stall        | P0       | Cold start and channel-entry video              |
| Room scene              | Wide gaps, low contrast, duplicate online indicators   | Larger centered workstations/characters and one status source           | Improves recognition for 3-5 friends             | P1       | 1280x720 and 1920x1080 screenshots              |
| Chat                    | Forced scroll-to-bottom and weak unread state          | Preserve reading position, date groups, unread affordance               | Prevents losing context                          | P1       | History and incoming-message tests              |
| Overlay                 | Whole-character thumbnails and mixed transition        | 44px capsule with 34px stable face crops                                | Readable during full-screen play                 | P1       | 1-5 member screenshots at 100/125% DPI          |
| Screen share            | Fixed fit behavior and basic drag                      | Remember contain/cover, compact panel, bounded pointer drag             | Keeps shared content useful without obstruction  | P1       | Two-peer share and resize test                  |
| Accessibility           | OS reduced motion only                                 | App overrides for motion, transparency, contrast, and scaling           | Gives predictable comfort controls               | P0       | Keyboard, high contrast, reduced motion tests   |
| Home server flow        | Server input competes with secondary copy              | Nickname then normalized server address and clear test result           | Keeps the only supported connection path obvious | P0       | First-run and invalid/valid server tests        |

## Motion tokens

- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`
- `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`
- `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`
- Press: 100-160ms
- Tooltip: 125-180ms
- Popover: 140-200ms
- Dropdown: 150-220ms
- Toast: 180-240ms
- Overlay: 180-260ms
- Page transition: 200-280ms

No `transition: all`, UI `ease-in`, `scale(0)`, or layout-property animation is permitted in the final audit.
