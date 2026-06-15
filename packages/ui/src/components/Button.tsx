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
    "border border-[#3D8FEE] bg-gradient-to-b from-[#5AAEFF] to-[#4295F5] text-white shadow-[0_2px_4px_rgba(30,45,70,0.12),0_1px_0_rgba(255,255,255,0.3)_inset] hover:from-[#4DA3FF] hover:to-[#3D8FEE] hover:shadow-[0_4px_12px_rgba(77,163,255,0.3),0_1px_0_rgba(255,255,255,0.3)_inset] active:shadow-[0_1px_2px_rgba(30,45,70,0.1)_inset]",
  secondary:
    "border border-[#D6DEE8] bg-gradient-to-b from-white to-[#F8FAFC] text-[#111827] shadow-[0_2px_4px_rgba(30,45,70,0.06),0_1px_0_rgba(255,255,255,0.9)_inset] hover:border-[#C4CED9] hover:from-[#FAFBFC] hover:to-[#F1F5F9] hover:shadow-[0_3px_8px_rgba(30,45,70,0.1),0_1px_0_rgba(255,255,255,0.9)_inset] active:shadow-[0_1px_2px_rgba(30,45,70,0.06)_inset]",
  ghost:
    "border border-transparent bg-transparent text-[#667085] hover:bg-white hover:text-[#111827] hover:shadow-[0_2px_6px_rgba(30,45,70,0.08)] active:shadow-none active:bg-[#F5F7FB]",
  danger:
    "border border-[#FCA5A5] bg-gradient-to-b from-[#FFF0F0] to-[#FEE2E2] text-[#DC2626] shadow-[0_2px_4px_rgba(30,45,70,0.06),0_1px_0_rgba(255,255,255,0.9)_inset] hover:border-[#F87171] hover:from-[#FEE2E2] hover:to-[#FECACA] hover:shadow-[0_3px_8px_rgba(220,38,38,0.12),0_1px_0_rgba(255,255,255,0.9)_inset] active:shadow-[0_1px_2px_rgba(30,45,70,0.06)_inset]",
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
      "inline-flex h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
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
