import type { InputHTMLAttributes } from "react";

export const Slider = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    type="range"
    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-sky-300"
    {...props}
  />
);
