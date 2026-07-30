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

export const SceneWallShelf = ({ className = "" }: { className?: string }) => {
  const id = useId().replace(/:/g, "");
  const shelfId = `${id}-shelf`;
  const shadowId = `${id}-shadow`;

  return (
    <svg viewBox="0 0 210 86" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={shelfId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dbe9f3" />
        </linearGradient>
        <radialGradient id={shadowId} cx="50%" cy="50%" rx="50%" ry="50%">
          <stop offset="0" stopColor="#57708b" stopOpacity="0.16" />
          <stop offset="1" stopColor="#57708b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="105" cy="77" rx="88" ry="7" fill={`url(#${shadowId})`} />
      <rect x="13" y="58" width="184" height="13" rx="6.5" fill={`url(#${shelfId})`} />
      <path d="M21 60h168" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <g transform="translate(31 14)">
        <rect x="0" y="12" width="19" height="33" rx="7" fill="#b9dafa" />
        <rect x="25" y="2" width="19" height="43" rx="7" fill="#86c0f4" />
        <rect x="50" y="19" width="19" height="26" rx="7" fill="#9edbc4" />
        <path
          d="M9.5 19v19M34.5 9v29M59.5 25v13"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.72"
        />
      </g>
      <g transform="translate(135 17)">
        <path d="M0 34h43l-6 12H6L0 34Z" fill="#d8e7f1" />
        <ellipse cx="20" cy="18" rx="9" ry="18" fill="#82c9aa" transform="rotate(-28 20 18)" />
        <ellipse cx="28" cy="19" rx="8" ry="16" fill="#a3ddbd" transform="rotate(27 28 19)" />
        <ellipse cx="12" cy="22" rx="6" ry="13" fill="#69b99b" transform="rotate(-49 12 22)" />
      </g>
    </svg>
  );
};

export const SceneWallClock = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 88 88" className={className} aria-hidden="true" focusable="false">
    <circle cx="44" cy="47" r="34" fill="#6f8aa3" opacity="0.12" />
    <circle cx="44" cy="42" r="32" fill="#ffffff" opacity="0.92" />
    <circle cx="44" cy="42" r="27" fill="#eaf5fb" stroke="#d2e4f0" strokeWidth="2" />
    <path d="M44 42V27M44 42l12 7" stroke="#72a9d8" strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="44" cy="42" r="3.5" fill="#72a9d8" />
    <path
      d="M28 62c10 5 23 5 32 0"
      stroke="#ffffff"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.8"
    />
  </svg>
);

export const SceneTallPlant = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 92 172" className={className} aria-hidden="true" focusable="false">
    <ellipse cx="46" cy="160" rx="37" ry="8" fill="#5b7188" opacity="0.1" />
    <path d="M24 105h44l-6 49H30l-6-49Z" fill="#d8e6ef" />
    <path d="M28 109h36" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
    <path
      d="M46 109V40M45 75 27 58M46 89l21-21"
      stroke="#74b99e"
      strokeWidth="4"
      strokeLinecap="round"
    />
    <ellipse cx="28" cy="49" rx="12" ry="25" fill="#8ed1b0" transform="rotate(-42 28 49)" />
    <ellipse cx="60" cy="55" rx="13" ry="28" fill="#72c09f" transform="rotate(39 60 55)" />
    <ellipse cx="43" cy="27" rx="12" ry="25" fill="#a4dbbd" transform="rotate(-9 43 27)" />
    <ellipse cx="25" cy="82" rx="10" ry="22" fill="#68b797" transform="rotate(-55 25 82)" />
    <ellipse cx="68" cy="86" rx="10" ry="22" fill="#90ceb0" transform="rotate(54 68 86)" />
  </svg>
);

export const SceneLowTable = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 164 118" className={className} aria-hidden="true" focusable="false">
    <ellipse cx="82" cy="106" rx="59" ry="8" fill="#526b84" opacity="0.1" />
    <path d="M67 60h30l7 43H60l7-43Z" fill="#dceaf3" />
    <path d="M73 63h18l4 35H68l5-35Z" fill="#eef7fb" opacity="0.86" />
    <ellipse cx="82" cy="55" rx="65" ry="24" fill="#e9f4fa" stroke="#d3e5f0" strokeWidth="2" />
    <ellipse cx="82" cy="49" rx="59" ry="18" fill="#f9fcfe" />
    <path d="M32 48c19-11 81-12 101 0" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    <g transform="translate(52 15)">
      <path d="M0 9h23l-2 25H3L0 9Z" fill="#a8d4f5" />
      <path
        d="M23 14c9-1 10 15 1 15"
        fill="none"
        stroke="#86bce5"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse cx="11.5" cy="9" rx="11.5" ry="4" fill="#d7edf9" />
      <path
        d="M6 8c3-3 8-3 11 0"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </g>
    <g transform="translate(92 21)">
      <path d="M0 8h20l-2 21H3L0 8Z" fill="#a6dcc0" />
      <path
        d="M20 12c8 0 8 12 1 13"
        fill="none"
        stroke="#79c29f"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <ellipse cx="10" cy="8" rx="10" ry="3.5" fill="#d9f1e5" />
    </g>
  </svg>
);
