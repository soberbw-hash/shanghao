import { useReducedMotion } from "framer-motion";

export const usePrefersReducedMotion = (appReduceMotion = false): boolean => {
  const systemReduceMotion = useReducedMotion();
  return appReduceMotion || systemReduceMotion === true;
};
