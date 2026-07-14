import { useId } from "react";

export const WorkstationArt = ({ className = "" }: { className?: string }) => {
  const assetId = useId().replace(/:/g, "");
  const shellGradientId = `${assetId}-shell`;
  const deskGradientId = `${assetId}-desk`;
  const edgeGradientId = `${assetId}-edge`;
  const legGradientId = `${assetId}-leg`;

  return (
    <svg viewBox="0 0 184 138" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={shellGradientId} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.58" stopColor="#f4f7fb" />
          <stop offset="1" stopColor="#dce7f2" />
        </linearGradient>
        <linearGradient id={deskGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.52" stopColor="#f7f9fc" />
          <stop offset="1" stopColor="#e7eef6" />
        </linearGradient>
        <linearGradient id={edgeGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#84c7ff" stopOpacity="0.18" />
          <stop offset="0.5" stopColor="#4da3ff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#84c7ff" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id={legGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d3dfeb" />
          <stop offset="0.48" stopColor="#f8fbff" />
          <stop offset="1" stopColor="#a9c4de" />
        </linearGradient>
      </defs>

      <ellipse cx="92" cy="124" rx="71" ry="9" fill="#536b86" opacity="0.1" />

      <path
        d="M25 96h12l-3.2 29.5c-.4 4-3.5 7-7.1 7-3.8 0-6.8-3.3-6.3-7.4L25 96Z"
        fill={`url(#${legGradientId})`}
      />
      <path
        d="M147 96h12l4.6 29.1c.5 4.1-2.5 7.4-6.3 7.4-3.6 0-6.7-3-7.1-7L147 96Z"
        fill={`url(#${legGradientId})`}
      />

      <rect x="12" y="72" width="160" height="35" rx="15" fill={`url(#${deskGradientId})`} />
      <rect x="16" y="75" width="152" height="2" rx="1" fill="#ffffff" opacity="0.92" />
      <rect x="28" y="102" width="128" height="2" rx="1" fill={`url(#${edgeGradientId})`} />

      <rect x="55" y="6" width="74" height="54" rx="14" fill={`url(#${shellGradientId})`} />
      <rect x="59" y="10" width="66" height="46" rx="10" fill="#202938" />
      <rect x="62" y="13" width="60" height="40" rx="8" fill="#111827" />
      <path d="M87 60h10v11H87z" fill="#dbe6f0" />
      <rect x="73" y="68" width="38" height="8" rx="4" fill={`url(#${shellGradientId})`} />
      <rect x="77" y="69" width="30" height="1.5" rx="0.75" fill="#ffffff" opacity="0.8" />

      <rect x="56" y="82" width="52" height="11" rx="5.5" fill="#dce9f5" />
      <rect x="58" y="81" width="48" height="9" rx="4.5" fill="#f8fbff" />
      <path d="M65 85h34" stroke="#bcd3e8" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <rect x="117" y="82" width="12" height="12" rx="6" fill="#d8e7f4" />
      <rect x="119" y="81" width="8" height="10" rx="4" fill="#f9fcff" />
    </svg>
  );
};
