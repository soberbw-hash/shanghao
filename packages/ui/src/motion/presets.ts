export const fadeSlideUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
};

export const gentleScale = {
  whileTap: { scale: 0.98 },
  whileHover: { scale: 1.01 },
  transition: { duration: 0.14, ease: "easeOut" }
};
