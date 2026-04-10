interface ProgressRingProps {
  value: number;
  size?: number;
}

export const ProgressRing = ({ value, size = 42 }: ProgressRingProps) => {
  const stroke = 4;
  const radius = size / 2 - stroke;
  const circumference = Math.PI * 2 * radius;
  const offset = circumference - Math.min(Math.max(value, 0), 1) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(139,211,255,1)"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
};
