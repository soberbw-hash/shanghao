import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type PointerEventHandler,
  type PropsWithChildren,
} from "react";
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
    "border border-[#4A96EE] bg-[linear-gradient(180deg,#62B1FF_0%,#438FEA_100%)] text-white shadow-[0_7px_18px_rgba(47,111,204,.2),inset_0_1px_0_rgba(255,255,255,.38)] hover:brightness-[1.025] hover:shadow-[0_9px_22px_rgba(47,111,204,.24),inset_0_1px_0_rgba(255,255,255,.46)] active:brightness-[.97]",
  secondary:
    "border border-[#D8E3F0] bg-[linear-gradient(180deg,rgba(255,255,255,.98),rgba(247,250,253,.96))] text-[#27364A] shadow-[0_4px_12px_rgba(63,102,160,.08),inset_0_1px_0_white] hover:border-[#C9D7E8] hover:bg-white hover:shadow-[0_6px_16px_rgba(63,102,160,.11),inset_0_1px_0_white]",
  ghost:
    "border border-transparent bg-transparent text-[#66768B] shadow-none hover:border-[#E0E8F2] hover:bg-[#F3F7FB] hover:text-[#27364A] active:bg-[#EAF1F8]",
  danger:
    "border border-[#E85252] bg-[linear-gradient(180deg,#FF7070,#E94B4B)] text-white shadow-[0_7px_18px_rgba(220,38,38,.18),inset_0_1px_0_rgba(255,255,255,.36)] hover:brightness-[1.025] hover:shadow-[0_9px_22px_rgba(220,38,38,.23),inset_0_1px_0_rgba(255,255,255,.42)]",
};

export const Button = ({
  children,
  className,
  variant = "primary",
  isFullWidth,
  onPointerMove,
  onPointerLeave,
  ...props
}: PropsWithChildren<ButtonProps>) => {
  const pointerFrameRef = useRef<number>();

  useEffect(
    () => () => {
      if (pointerFrameRef.current !== undefined) {
        cancelAnimationFrame(pointerFrameRef.current);
      }
    },
    [],
  );

  const updatePointerLight: PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerMove?.(event);
    const button = event.currentTarget;
    const bounds = button.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100;
    const y = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100;

    if (pointerFrameRef.current !== undefined) {
      cancelAnimationFrame(pointerFrameRef.current);
    }
    pointerFrameRef.current = requestAnimationFrame(() => {
      button.style.setProperty("--button-pointer-x", `${x.toFixed(1)}%`);
      button.style.setProperty("--button-pointer-y", `${y.toFixed(1)}%`);
      pointerFrameRef.current = undefined;
    });
  };

  const resetPointerLight: PointerEventHandler<HTMLButtonElement> = (event) => {
    onPointerLeave?.(event);
    if (pointerFrameRef.current !== undefined) {
      cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = undefined;
    }
    event.currentTarget.style.setProperty("--button-pointer-x", "50%");
    event.currentTarget.style.setProperty("--button-pointer-y", "50%");
  };

  return (
    <motion.button
      type="button"
      className={cn(
        "shanghao-motion-button group relative isolate inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-[13px] px-4 text-sm font-medium transition-[transform,filter,background-color,border-color,box-shadow,opacity,color] duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4DA3FF]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F7FA]",
        variantClasses[variant],
        isFullWidth && "w-full",
        className,
      )}
      {...gentleScale}
      {...props}
      onPointerMove={updatePointerLight}
      onPointerLeave={resetPointerLight}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(100px circle at var(--button-pointer-x, 50%) var(--button-pointer-y, 50%), rgba(255,255,255,.32), transparent 72%)",
        }}
      />
      <span className="shanghao-motion-button-content relative z-[1] inline-flex min-w-0 items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
};
