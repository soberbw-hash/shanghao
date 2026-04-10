export const formatPercentage = (value: number): string => `${Math.round(value * 100)}%`;

export const formatLatency = (latencyMs: number): string => `${Math.round(latencyMs)} ms`;
