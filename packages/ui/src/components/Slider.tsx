import type { ChangeEvent, CSSProperties, InputHTMLAttributes } from "react";

interface SliderProps extends InputHTMLAttributes<HTMLInputElement> {
  referenceValue?: number;
  snapThreshold?: number;
}

export const Slider = ({
  className = "",
  style,
  referenceValue,
  snapThreshold = 0,
  onChange,
  ...props
}: SliderProps) => {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const value = Number(props.value ?? props.defaultValue ?? min);
  const progress = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const referencePosition =
    typeof referenceValue === "number" &&
    referenceValue >= min &&
    referenceValue <= max &&
    max > min
      ? ((referenceValue - min) / (max - min)) * 100
      : undefined;
  const sliderStyle = {
    ...style,
    "--slider-progress": `${progress}%`,
    "--slider-reference": `${referencePosition ?? 0}%`,
  } as CSSProperties;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (
      typeof referenceValue === "number" &&
      snapThreshold > 0 &&
      Math.abs(Number(event.currentTarget.value) - referenceValue) <= snapThreshold
    ) {
      event.currentTarget.value = String(referenceValue);
    }
    onChange?.(event);
  };

  return (
    <span className="slider-shell" style={sliderStyle}>
      <input
        type="range"
        className={`liquid-slider h-2 w-full cursor-pointer appearance-none rounded-full ${className}`.trim()}
        {...props}
        onChange={handleChange}
      />
      {referencePosition !== undefined ? (
        <span className="slider-reference-node" aria-hidden="true" />
      ) : null}
    </span>
  );
};
