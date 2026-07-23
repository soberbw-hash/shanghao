import { useId } from "react";

export const SceneWindowNook = ({ className = "" }: { className?: string }) => {
  const id = useId().replace(/:/g, "");
  const glassId = `${id}-glass`;
  const frameId = `${id}-frame`;
  const shadowId = `${id}-shadow`;

  return (
    <svg viewBox="0 0 180 110" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={glassId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9eeff" stopOpacity="0.9" />
          <stop offset="0.58" stopColor="#edf8ff" stopOpacity="0.72" />
          <stop offset="1" stopColor="#dff7ef" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient id={frameId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dce9f3" />
        </linearGradient>
        <radialGradient id={shadowId} cx="50%" cy="50%" rx="50%" ry="50%">
          <stop offset="0" stopColor="#58728f" stopOpacity="0.17" />
          <stop offset="1" stopColor="#58728f" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="90" cy="98" rx="76" ry="9" fill={`url(#${shadowId})`} />
      <rect x="9" y="7" width="162" height="72" rx="20" fill={`url(#${frameId})`} />
      <rect x="15" y="13" width="150" height="58" rx="15" fill={`url(#${glassId})`} />
      <path d="M90 14v56" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.72" />
      <path d="M18 45h144" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.42" />
      <path
        d="M28 23c18 7 31 8 46 5"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeOpacity="0.46"
      />
      <rect x="2" y="70" width="176" height="18" rx="9" fill={`url(#${frameId})`} />
      <rect x="8" y="72" width="164" height="2" rx="1" fill="#ffffff" opacity="0.92" />

      <g transform="translate(31 61)">
        <path d="M0 18h22l-3 17H3L0 18Z" fill="#d5e5ef" />
        <path d="M3 20h16" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="11" cy="13" rx="6" ry="13" fill="#78c8a6" transform="rotate(-24 11 13)" />
        <ellipse cx="15" cy="12" rx="5" ry="11" fill="#9ad7b8" transform="rotate(25 15 12)" />
        <ellipse cx="7" cy="14" rx="4" ry="9" fill="#66ba9b" transform="rotate(-48 7 14)" />
      </g>
      <g transform="translate(126 65)">
        <path d="M0 14h20l-2.5 15h-15L0 14Z" fill="#dce9f2" />
        <path d="M3 16h14" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="10" cy="9" rx="5" ry="10" fill="#8fd2b0" transform="rotate(-28 10 9)" />
        <ellipse cx="14" cy="8" rx="4" ry="9" fill="#71c29f" transform="rotate(31 14 8)" />
      </g>
    </svg>
  );
};

export const SceneFloorLamp = ({ className = "" }: { className?: string }) => {
  const id = useId().replace(/:/g, "");
  const glowId = `${id}-glow`;
  const shellId = `${id}-shell`;
  const shadowId = `${id}-shadow`;

  return (
    <svg viewBox="0 0 94 218" className={className} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" rx="50%" ry="50%">
          <stop offset="0" stopColor="#ffdca3" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffdca3" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={shellId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d7e5ef" />
        </linearGradient>
        <radialGradient id={shadowId} cx="50%" cy="50%" rx="50%" ry="50%">
          <stop offset="0" stopColor="#536b85" stopOpacity="0.2" />
          <stop offset="1" stopColor="#536b85" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="48" cy="54" r="43" fill={`url(#${glowId})`} />
      <path
        d="M47 64c0 44-4 78-4 118"
        fill="none"
        stroke="#b9ccdc"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M48 64c0 42-2 78-2 116"
        fill="none"
        stroke="#f8fbfd"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.82"
      />
      <path d="M17 59c4-26 16-39 31-39 16 0 28 13 32 39H17Z" fill={`url(#${shellId})`} />
      <path d="M23 56h51" stroke="#ffd9a0" strokeWidth="5" strokeLinecap="round" opacity="0.78" />
      <ellipse cx="45" cy="203" rx="37" ry="9" fill={`url(#${shadowId})`} />
      <ellipse cx="44" cy="189" rx="24" ry="8" fill="#d3e2ed" />
      <ellipse cx="44" cy="186" rx="20" ry="6" fill={`url(#${shellId})`} />
    </svg>
  );
};
