import type { InputHTMLAttributes } from "react";

export const Slider = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    type="range"
    className="liquid-slider h-2 w-full cursor-pointer appearance-none rounded-full"
    {...props}
  />
);
