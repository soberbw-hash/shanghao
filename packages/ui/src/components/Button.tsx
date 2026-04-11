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
    "border border-[#4DA3FF] bg-[#4DA3FF] text-white shadow-[0_8px_18px_rgba(77,163,255,0.24)] hover:bg-[#3996F7] hover:border-[#3996F7]",
  secondary:
    "border border-[#E7ECF2] bg-white text-[#111827] shadow-[0_4px_12px_rgba(17,24,39,0.05)] hover:border-[#D6DEE8] hover:bg-[#F8FAFC]",
  ghost:
    "border border-transparent bg-transparent text-[#667085] hover:bg-white hover:text-[#111827]",
  danger:
    "border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] hover:border-[#FCA5A5] hover:bg-[#FEE2E2]",
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
      "inline-flex h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-55",
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
