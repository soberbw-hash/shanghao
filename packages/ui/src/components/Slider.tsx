import type { CSSProperties, InputHTMLAttributes } from "react";

export const Slider = ({
  className = "",
  style,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const value = Number(props.value ?? props.defaultValue ?? min);
  const progress = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const sliderStyle = {
    ...style,
    "--slider-progress": `${progress}%`,
  } as CSSProperties;

  return (
    <input
      type="range"
      className={`liquid-slider h-2 w-full cursor-pointer appearance-none rounded-full ${className}`.trim()}
      style={sliderStyle}
      {...props}
    />
  );
};
