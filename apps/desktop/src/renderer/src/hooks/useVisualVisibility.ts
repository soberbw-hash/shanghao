import { useEffect, useRef, useState } from "react";

import { visualRuntimeController } from "../features/visual-runtime/VisualRuntimeController";

export const useVisualVisibility = (): boolean => {
  const [visible, setVisible] = useState(() => visualRuntimeController.isVisible());
  useEffect(() => visualRuntimeController.subscribeVisibility(setVisible), []);
  return visible;
};

export const useVisibleInterval = (callback: () => void, intervalMs: number): void => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const setVisible = (visible: boolean) => {
      clear();
      if (!visible) return;
      callbackRef.current();
      timer = window.setInterval(() => callbackRef.current(), intervalMs);
    };
    const unsubscribe = visualRuntimeController.subscribeVisibility(setVisible);
    return () => {
      unsubscribe();
      clear();
    };
  }, [intervalMs]);
};
