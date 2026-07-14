import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  type ScreenShareViewerFrame,
} from "@private-voice/shared";

export const ScreenShareViewerPage = () => {
  const [frame, setFrame] = useState<ScreenShareViewerFrame>();
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => window.desktopApi.screenShareViewer.onFrame(setFrame), []);

  return (
    <motion.main
      className="screen-share-viewer-page"
      initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.992 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : APPLE_MOTION_DURATION.panel,
        ease: APPLE_MOTION_EASE,
      }}
    >
      {frame?.dataUrl ? (
        <motion.img
          src={frame.dataUrl}
          alt={frame.title}
          draggable={false}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.986 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: shouldReduceMotion ? 0 : APPLE_MOTION_DURATION.panel,
            ease: APPLE_MOTION_EASE,
          }}
        />
      ) : (
        <div className="screen-share-viewer-loading">
          <span />
          <strong>正在接收共享画面...</strong>
        </div>
      )}
    </motion.main>
  );
};
