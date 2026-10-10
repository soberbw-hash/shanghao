import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useReducedMotion } from "framer-motion";
import { Check, LoaderCircle } from "lucide-react";
import { gsap } from "gsap";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import "./digit-code-input.css";

type CodeState = "idle" | "checking" | "success" | "error";
const stateLabels: Record<CodeState, string> = {
  idle: "",
  checking: "检查中",
  success: "检查通过",
  error: "请检查输入",
};
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> & {
  value: string;
  onValueChange: (value: string) => void;
  status?: CodeState;
  statusLabel?: string;
  length?: number;
};
const digits = (text: string) =>
  text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");

/** One native text input preserves paste, autofill, selection and leading zeroes. */
export const DigitCodeInput = ({
  value,
  onValueChange,
  status = "idle",
  statusLabel,
  length = 6,
  className = "",
  disabled,
  ...props
}: Props) => {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | undefined>(undefined);
  const previousStatus = useRef<CodeState>("idle");
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(value.length);
  const [selectionEnd, setSelectionEnd] = useState(value.length);
  const reduceMotion = useReducedMotion();
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    setCursor(pendingCaret.current);
    setSelectionEnd(pendingCaret.current);
    pendingCaret.current = undefined;
  }, [value]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const completing = previousStatus.current === "checking" && status === "success";
    previousStatus.current = status;
    const context = gsap.context(() => {
      const cells = Array.from(element.querySelectorAll<HTMLElement>(".digit-code-cell"));
      const badge = element.querySelector(".digit-code-result");
      gsap.set(badge, { opacity: 0, scale: 0.85 });
      if (status === "error" && !reduceMotion) {
        gsap.fromTo(
          cells,
          { x: -3 },
          { x: 0, duration: motionDuration.fast, ease: motionEase.feedback },
        );
      }
      if (status !== "checking" && status !== "success") return;
      const duration = reduceMotion ? motionDuration.instant : motionDuration.compact;
      const timeline = gsap.timeline({ defaults: { duration, ease: motionEase.feedback } });
      const merged = {
        x: (index: number) =>
          reduceMotion
            ? 0
            : element.clientWidth / 2 - cells[index]!.offsetLeft - cells[index]!.offsetWidth / 2,
        scale: reduceMotion ? 1 : 0.85,
        opacity: 0,
      };
      if (completing) {
        gsap.set(cells, merged);
        gsap.set(badge, { opacity: 1, scale: 1 });
      } else
        timeline
          .to(cells, {
            ...merged,
            stagger: reduceMotion ? 0 : { each: 0.025, from: "edges" },
          })
          .to(badge, { opacity: 1, scale: 1 }, "<0.08");
      if (status === "success") {
        timeline
          .to(badge, { opacity: 0 }, "+=0.3")
          .to(cells, { x: 0, scale: 1, opacity: 1, stagger: 0 }, "<");
      }
    }, element);
    return () => context.revert();
  }, [status, reduceMotion]);
  const commit = (text: string, caret: number) => {
    const clean = digits(text).slice(0, length);
    pendingCaret.current = Math.min(caret, clean.length);
    onValueChange(clean);
    if (clean === value) {
      input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCursor(pendingCaret.current);
      setSelectionEnd(pendingCaret.current);
      pendingCaret.current = undefined;
    }
  };
  return (
    <div
      ref={root}
      className={`digit-code-input ${className}`}
      data-state={status}
      data-disabled={disabled || undefined}
      data-focused={focused || undefined}
      style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const index = Math.max(
          0,
          Math.min(
            value.length,
            length - 1,
            Math.floor((event.clientX - rect.left) / (rect.width / length)),
          ),
        );
        input.current?.focus();
        input.current?.setSelectionRange(index, Math.min(index + 1, value.length));
        setCursor(index);
        setSelectionEnd(Math.min(index + 1, value.length));
      }}
    >
      {Array.from({ length }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="digit-code-cell"
          data-active={(focused && index === cursor) || undefined}
          data-filled={Boolean(value[index]) || undefined}
          data-selected={(focused && index >= cursor && index < selectionEnd) || undefined}
        >
          {value[index] ? (
            <span key={value[index]} className="digit-code-glyph">
              {value[index]}
            </span>
          ) : (
            <span className="digit-code-empty" />
          )}
        </span>
      ))}
      <input
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        value={value}
        maxLength={length}
        disabled={disabled}
        aria-invalid={status === "error" || undefined}
        aria-busy={status === "checking"}
        className="digit-code-native"
        onFocus={(event) => {
          setFocused(true);
          setCursor(event.currentTarget.selectionStart ?? value.length);
          setSelectionEnd(event.currentTarget.selectionEnd ?? value.length);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        onSelect={(event) => {
          setCursor(event.currentTarget.selectionStart ?? 0);
          setSelectionEnd(event.currentTarget.selectionEnd ?? 0);
        }}
        onChange={(event) =>
          commit(
            event.target.value,
            digits(event.target.value.slice(0, event.target.selectionStart ?? length)).length,
          )
        }
        onPaste={(event) => {
          event.preventDefault();
          const inserted = digits(event.clipboardData.getData("text"));
          if (!inserted) return;
          if (inserted.length >= length) {
            commit(inserted, length);
            return;
          }
          const start = event.currentTarget.selectionStart ?? 0;
          const end = event.currentTarget.selectionEnd ?? start;
          commit(value.slice(0, start) + inserted + value.slice(end), start + inserted.length);
        }}
      />
      <span aria-hidden="true" className="digit-code-result">
        <span className="digit-code-result-box">
          {status === "success" ? <Check /> : <LoaderCircle className="digit-code-spinner" />}
        </span>
      </span>
      <span className="sr-only" role="status">
        {statusLabel ?? stateLabels[status]}
      </span>
    </div>
  );
};
