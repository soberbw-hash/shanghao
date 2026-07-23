import { useId } from "react";

export const WorkstationArt = ({ className = "" }: { className?: string }) => {
  const assetId = useId().replace(/:/g, "");
  const shellGradientId = `${assetId}-shell`;
  const deskGradientId = `${assetId}-desk`;
  const screenShellGradientId = `${assetId}-screen-shell`;
  const edgeGradientId = `${assetId}-edge`;
  const legGradientId = `${assetId}-leg`;
  const shadowGradientId = `${assetId}-shadow`;

  return (
    <svg viewBox="0 0 184 138" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={shellGradientId} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.56" stopColor="#f5f9fc" />
          <stop offset="1" stopColor="#d8e5ef" />
        </linearGradient>
        <linearGradient id={deskGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.48" stopColor="#f8fbfd" />
          <stop offset="1" stopColor="#e2ebf2" />
        </linearGradient>
        <linearGradient id={screenShellGradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f9fbfd" />
          <stop offset="0.5" stopColor="#e8eef3" />
          <stop offset="1" stopColor="#cbd9e4" />
        </linearGradient>
        <linearGradient id={edgeGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#84c7ff" stopOpacity="0.18" />
          <stop offset="0.5" stopColor="#4da3ff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#84c7ff" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id={legGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c8d7e3" />
          <stop offset="0.5" stopColor="#f8fbfd" />
          <stop offset="1" stopColor="#adc4d7" />
        </linearGradient>
        <radialGradient id={shadowGradientId} cx="50%" cy="50%" rx="50%" ry="50%">
          <stop offset="0" stopColor="#42566d" stopOpacity="0.18" />
          <stop offset="1" stopColor="#42566d" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="92" cy="124" rx="70" ry="10" fill={`url(#${shadowGradientId})`} />

      <path
        d="M27 96h12l-2.6 29.2c-.35 3.8-3.1 6.6-6.5 6.6-3.7 0-6.4-3.2-5.9-7.1L27 96Z"
        fill={`url(#${legGradientId})`}
      />
      <path
        d="M145 96h12l3 28.7c.5 3.9-2.2 7.1-5.9 7.1-3.4 0-6.1-2.8-6.5-6.6L145 96Z"
        fill={`url(#${legGradientId})`}
      />

      <rect x="16" y="76" width="152" height="31" rx="14" fill={`url(#${deskGradientId})`} />
      <rect x="20" y="79" width="144" height="2" rx="1" fill="#ffffff" opacity="0.92" />
      <rect x="31" y="102" width="122" height="2" rx="1" fill={`url(#${edgeGradientId})`} />

      <rect x="47" y="5" width="90" height="61" rx="17" fill={`url(#${screenShellGradientId})`} />
      <rect x="51" y="9" width="82" height="53" rx="13" fill="#263040" />
      <rect x="54" y="12" width="76" height="47" rx="10" fill="#141c28" />
      <path d="M87 66h10v9H87z" fill="#d8e4ed" />
      <rect x="72" y="72" width="40" height="7" rx="3.5" fill={`url(#${shellGradientId})`} />
      <rect x="77" y="73" width="30" height="1.5" rx="0.75" fill="#ffffff" opacity="0.78" />

      <rect x="55" y="85" width="55" height="9" rx="4.5" fill="#d9e7f2" />
      <rect x="58" y="84" width="49" height="7" rx="3.5" fill="#f9fcfe" />
      <path
        d="M67 87.5h31"
        stroke="#aec9df"
        strokeWidth="1.35"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="124" cy="88.5" r="5.5" fill="#d9e7f2" />
      <circle cx="124" cy="87" r="3.8" fill="#fbfdff" />
    </svg>
  );
};
