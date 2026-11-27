import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { motionCurve, motionDuration } from "../../features/motion/motionSystem";

/** Keep the composer, scroll position and quick actions alive during either transition. */
export function ChatContentSwitcher({
  children,
  alternate,
  active,
  reduceMotion,
  idPrefix,
}: {
  children: ReactNode;
  alternate?: ReactNode;
  active: boolean;
  reduceMotion: boolean;
  idPrefix?: string;
}) {
  if (!alternate) return children;
  return (
    <div className="chat-content-stage" data-reduce-motion={reduceMotion}>
      {(["chat", "chronicle"] as const).map((tab) => {
        const visible = (tab === "chronicle") === active;
        return (
          <motion.div
            key={tab}
            className="chat-content-page"
            data-active={visible}
            id={idPrefix ? `${idPrefix}-panel-${tab}` : undefined}
            role={idPrefix ? "tabpanel" : undefined}
            aria-labelledby={idPrefix ? `${idPrefix}-tab-${tab}` : undefined}
            aria-hidden={!visible}
            inert={!visible}
            initial={false}
            animate={{
              opacity: visible ? 1 : 0,
              x: reduceMotion || visible ? 0 : tab === "chat" ? -5 : 5,
            }}
            transition={{
              duration: reduceMotion ? motionDuration.instant : motionDuration.compact,
              ease: motionCurve.enter,
            }}
          >
            {tab === "chat" ? children : alternate}
          </motion.div>
        );
      })}
    </div>
  );
}
