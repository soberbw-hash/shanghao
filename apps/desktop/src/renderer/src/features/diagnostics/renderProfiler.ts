import { useRef } from "react";

export interface RenderProfileSnapshot {
  counts: Record<string, number>;
  reasons: Record<string, Record<string, number>>;
}

interface RenderProfileEntry {
  count: number;
  reasons: Map<string, number>;
}

const entries = new Map<string, RenderProfileEntry>();
let isRenderProfilingEnabled = false;

export const setRenderProfilingEnabled = (enabled: boolean): void => {
  isRenderProfilingEnabled = enabled;
  if (!enabled) entries.clear();
};

export const resetRenderProfile = (): void => {
  entries.clear();
};

export const recordComponentRender = (name: string, changedKeys: string[]): void => {
  if (!isRenderProfilingEnabled) return;
  const entry = entries.get(name) ?? { count: 0, reasons: new Map<string, number>() };
  entry.count += 1;
  for (const key of changedKeys.length > 0 ? changedKeys : ["mount-or-unknown"]) {
    entry.reasons.set(key, (entry.reasons.get(key) ?? 0) + 1);
  }
  entries.set(name, entry);
};

export const getRenderProfileSnapshot = (): RenderProfileSnapshot => ({
  counts: Object.fromEntries([...entries].map(([name, entry]) => [name, entry.count])),
  reasons: Object.fromEntries(
    [...entries].map(([name, entry]) => [name, Object.fromEntries(entry.reasons)]),
  ),
});

/** Development-only render attribution with no React state or subscriptions. */
export const useRenderProfiler = (
  name: string,
  inputs: Readonly<Record<string, unknown>>,
): void => {
  const previousRef = useRef<Readonly<Record<string, unknown>> | undefined>(undefined);
  const previous = previousRef.current;
  const changedKeys = previous
    ? Object.keys(inputs).filter((key) => !Object.is(inputs[key], previous[key]))
    : ["mount"];
  recordComponentRender(name, changedKeys);
  previousRef.current = inputs;
};
