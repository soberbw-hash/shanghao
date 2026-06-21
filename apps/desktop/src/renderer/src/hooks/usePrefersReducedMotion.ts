import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export const usePrefersReducedMotion = (appReduceMotion = false) => {
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia(QUERY);
    const sync = () => setSystemReduceMotion(mediaQuery.matches);
    sync();

    mediaQuery.addEventListener?.("change", sync);
    return () => mediaQuery.removeEventListener?.("change", sync);
  }, []);

  return appReduceMotion || systemReduceMotion;
};
