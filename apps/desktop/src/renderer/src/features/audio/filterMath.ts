export const FOURTH_ORDER_BUTTERWORTH_Q = [0.5411961, 1.306563] as const;

export const fourthOrderHighPassMagnitude = (frequency: number, cutoff: number): number => {
  if (frequency <= 0 || cutoff <= 0) return 0;
  return 1 / Math.sqrt(1 + (cutoff / frequency) ** 8);
};
