import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { motion, type MotionProps } from "framer-motion";

import { gentleScale } from "../motion/presets";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  keyof MotionProps
>;

export interface ButtonProps extends NativeButtonProps, MotionProps {
  variant?: ButtonVariant;
  isFullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[rgba(139,211,255,0.14)] text-white border border-[rgba(139,211,255,0.25)] hover:bg-[rgba(139,211,255,0.22)]",
  secondary:
    "bg-white/6 text-white border border-white/10 hover:bg-white/10",
  ghost: "bg-transparent text-white/70 hover:bg-white/6 border border-transparent",
  danger:
    "bg-[rgba(248,113,113,0.14)] text-white border border-[rgba(248,113,113,0.24)] hover:bg-[rgba(248,113,113,0.2)]"
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
      "inline-flex h-11 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
      variantClasses[variant],
      isFullWidth && "w-full",
      className
    )}
    {...gentleScale}
    {...props}
  >
    {children}
  </motion.button>
);
