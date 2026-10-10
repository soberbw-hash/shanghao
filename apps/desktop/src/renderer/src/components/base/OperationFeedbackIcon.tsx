import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, LoaderCircle, Save } from "lucide-react";
import { motionDuration, motionCurve } from "../../features/motion/motionSystem";
import "./operation-feedback.css";

/** Visual feedback only: the operation owner supplies confirmed request state. */
export const OperationFeedbackIcon = ({
  state,
  idleIcon = <Save size={16} />,
}: {
  state: "idle" | "pending" | "success";
  idleIcon?: ReactNode;
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <span className="operation-feedback-icon" aria-hidden="true">
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={state}
          className="operation-feedback-layer"
          initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.7, y: reduceMotion ? 0 : 3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.7, y: reduceMotion ? 0 : -3 }}
          transition={{
            duration: reduceMotion ? motionDuration.instant : motionDuration.fast,
            ease: motionCurve.standard,
          }}
        >
          {state === "pending" ? (
            <span className="operation-feedback-spin">
              <LoaderCircle size={16} />
            </span>
          ) : state === "success" ? (
            <Check size={16} />
          ) : (
            idleIcon
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};
