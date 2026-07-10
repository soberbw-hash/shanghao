import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { motion, type MotionProps } from "framer-motion";

import { gentleScale } from "../motion/presets";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps>;

export interface ButtonProps extends NativeButtonProps, MotionProps {
  variant?: ButtonVariant;
  isFullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-white/45 bg-[linear-gradient(180deg,rgba(104,181,255,.96),rgba(57,137,238,.94))] text-white shadow-[0_8px_24px_rgba(47,111,204,.24),inset_0_1px_0_rgba(255,255,255,.46),inset_0_-1px_0_rgba(32,92,180,.22)] backdrop-blur-xl hover:brightness-[1.04] hover:shadow-[0_12px_30px_rgba(47,111,204,.3),inset_0_1px_0_rgba(255,255,255,.52)] active:brightness-[.98]",
  secondary:
    "border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,.78),rgba(243,248,255,.54))] text-[#172033] shadow-[0_7px_22px_rgba(63,102,160,.1),inset_0_1px_0_rgba(255,255,255,.92),inset_0_-1px_0_rgba(130,160,198,.1)] backdrop-blur-2xl hover:border-white/90 hover:bg-white/75 hover:shadow-[0_10px_28px_rgba(63,102,160,.14),inset_0_1px_0_white]",
  ghost:
    "border border-transparent bg-white/20 text-[#667085] backdrop-blur-lg hover:border-white/70 hover:bg-white/58 hover:text-[#172033] hover:shadow-[0_7px_20px_rgba(63,102,160,.09),inset_0_1px_0_rgba(255,255,255,.85)] active:bg-white/42",
  danger:
    "border border-white/55 bg-[linear-gradient(180deg,rgba(255,111,111,.94),rgba(231,66,66,.92))] text-white shadow-[0_8px_22px_rgba(220,38,38,.2),inset_0_1px_0_rgba(255,255,255,.45)] backdrop-blur-xl hover:brightness-[1.04] hover:shadow-[0_11px_28px_rgba(220,38,38,.27),inset_0_1px_0_rgba(255,255,255,.48)]",
};

export const Button = ({
  children,
  className,
  variant = "primary",
  isFullWidth,
  ...props
}: PropsWithChildren<ButtonProps>) => (
  <motion.button
    type="button"
    className={cn(
      "inline-flex h-11 items-center justify-center gap-2 rounded-[15px] px-4 text-sm font-medium transition-[transform,filter,background-color,border-color,box-shadow,opacity,color] duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4DA3FF]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F7FA]",
      variantClasses[variant],
      isFullWidth && "w-full",
      className,
    )}
    {...gentleScale}
    {...props}
  >
    {children}
  </motion.button>
);
