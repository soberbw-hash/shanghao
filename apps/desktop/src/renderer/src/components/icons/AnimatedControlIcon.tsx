import { cn } from "@private-voice/ui";

export type AnimatedControlIconName =
  | "bell"
  | "bookmark"
  | "exit"
  | "headphones"
  | "invite"
  | "mic"
  | "overlay"
  | "record"
  | "screen-share"
  | "settings"
  | "speaker";

interface AnimatedControlIconProps {
  name: AnimatedControlIconName;
  active?: boolean;
  muted?: boolean;
  className?: string;
}

const iconArtwork = (name: AnimatedControlIconName, active: boolean, muted: boolean) => {
  switch (name) {
    case "mic":
      return (
        <>
          <rect className="animated-icon__mic-capsule" x="9" y="3" width="6" height="11" rx="3" />
          <path
            className="animated-icon__mic-cradle"
            d="M5.5 10.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 17.5V21M9 21h6"
          />
          <path
            className="animated-icon__mic-pulse animated-icon__mic-pulse--left"
            d="M3.7 8.8a9.2 9.2 0 0 0 0 4.4"
          />
          <path
            className="animated-icon__mic-pulse animated-icon__mic-pulse--right"
            d="M20.3 8.8a9.2 9.2 0 0 1 0 4.4"
          />
          {muted ? <path className="animated-icon__slash" d="M4 4l16 16" /> : null}
        </>
      );
    case "speaker":
      return (
        <>
          <path className="animated-icon__speaker-body" d="M4 9h4l5-4v14l-5-4H4z" />
          <path
            className="animated-icon__speaker-wave animated-icon__speaker-wave--one"
            d="M16 9.2a4 4 0 0 1 0 5.6"
          />
          <path
            className="animated-icon__speaker-wave animated-icon__speaker-wave--two"
            d="M18.7 6.7a7.5 7.5 0 0 1 0 10.6"
          />
          {muted ? <path className="animated-icon__slash" d="M15.5 8.5l5 7" /> : null}
        </>
      );
    case "bell":
      return (
        <>
          <g className="animated-icon__bell-shell">
            <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 5 2.2 5.6 2.2 5.6H4.3S6.5 15 6.5 10Z" />
          </g>
          <path className="animated-icon__bell-clapper" d="M9.5 18a2.7 2.7 0 0 0 5 0" />
        </>
      );
    case "invite":
      return (
        <>
          <circle className="animated-icon__invite-head" cx="8.5" cy="8" r="3" />
          <path className="animated-icon__invite-body" d="M3.5 19c.3-4 2.1-6 5-6s4.7 2 5 6" />
          <g className="animated-icon__invite-plus">
            <path d="M18 8v7M14.5 11.5h7" />
          </g>
        </>
      );
    case "settings":
      return (
        <>
          <path className="animated-icon__settings-track" d="M4 6h16M4 12h16M4 18h16" />
          <circle
            className="animated-icon__settings-knob animated-icon__settings-knob--one"
            cx="9"
            cy="6"
            r="2"
          />
          <circle
            className="animated-icon__settings-knob animated-icon__settings-knob--two"
            cx="15"
            cy="12"
            r="2"
          />
          <circle
            className="animated-icon__settings-knob animated-icon__settings-knob--three"
            cx="8"
            cy="18"
            r="2"
          />
        </>
      );
    case "record":
      return (
        <>
          <circle className="animated-icon__record-ring" cx="12" cy="12" r="8" />
          {active ? (
            <rect
              className="animated-icon__record-core"
              x="9"
              y="9"
              width="6"
              height="6"
              rx="1.5"
            />
          ) : (
            <circle className="animated-icon__record-core" cx="12" cy="12" r="3.5" />
          )}
        </>
      );
    case "bookmark":
      return (
        <>
          <path className="animated-icon__bookmark-body" d="M6.5 4.5h11v15l-5.5-3-5.5 3z" />
          <g className="animated-icon__bookmark-plus">
            <path d="M12 7v5M9.5 9.5h5" />
          </g>
        </>
      );
    case "screen-share":
      return (
        <>
          <rect
            className="animated-icon__screen-frame"
            x="3.5"
            y="4.5"
            width="17"
            height="12"
            rx="2.5"
          />
          <path className="animated-icon__screen-stand" d="M9 20h6M12 16.5V20" />
          <g className="animated-icon__screen-arrow">
            <path d="M12 13V8M9.5 10.5 12 8l2.5 2.5" />
          </g>
        </>
      );
    case "overlay":
      return (
        <>
          <rect
            className="animated-icon__overlay-back"
            x="3.5"
            y="4.5"
            width="12"
            height="10"
            rx="2"
          />
          <rect
            className="animated-icon__overlay-front"
            x="8.5"
            y="9.5"
            width="12"
            height="10"
            rx="2"
          />
        </>
      );
    case "exit":
      return (
        <>
          <path className="animated-icon__exit-door" d="M10 4H5.5v16H10M14 8l4 4-4 4" />
          <path className="animated-icon__exit-arrow" d="M18 12H9" />
        </>
      );
    case "headphones":
      return (
        <>
          <path className="animated-icon__headphones-band" d="M5 13v-2a7 7 0 0 1 14 0v2" />
          <rect
            className="animated-icon__headphones-cup animated-icon__headphones-cup--left"
            x="3.5"
            y="12"
            width="4"
            height="7"
            rx="2"
          />
          <rect
            className="animated-icon__headphones-cup animated-icon__headphones-cup--right"
            x="16.5"
            y="12"
            width="4"
            height="7"
            rx="2"
          />
        </>
      );
  }
};

export const AnimatedControlIcon = ({
  name,
  active = false,
  muted = false,
  className,
}: AnimatedControlIconProps) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    className={cn("animated-control-icon", `animated-control-icon--${name}`, className)}
    data-active={active ? "true" : "false"}
    data-muted={muted ? "true" : "false"}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {iconArtwork(name, active, muted)}
  </svg>
);
