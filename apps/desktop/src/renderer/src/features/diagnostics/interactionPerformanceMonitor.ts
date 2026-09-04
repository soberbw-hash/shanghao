import type { FramePerformanceSnapshot } from "@private-voice/shared";

import { rendererPerformanceMonitor } from "./rendererPerformanceMonitor";

export type InteractionStage =
  | "interaction-start"
  | "visual-feedback-start"
  | "route-transition-start"
  | "page-first-paint"
  | "page-interactive"
  | "background-init-complete";

export interface InteractionTiming {
  id: string;
  name: string;
  route: string;
  startedAt: number;
  stages: Partial<Record<InteractionStage, number>>;
  durationMs?: number;
}

export interface ReactCommitTiming {
  component: string;
  phase: "mount" | "update" | "nested-update";
  actualDurationMs: number;
  committedAt: number;
}

export interface InteractionPerformanceSnapshot {
  capturedAt: number;
  route: string;
  domNodeCount: number;
  jsHeapUsedBytes?: number;
  frame: FramePerformanceSnapshot;
  interactions: InteractionTiming[];
  reactCommits: ReactCommitTiming[];
  lastInteractionLatencyMs?: number;
}

const MAX_INTERACTIONS = 80;
const MAX_REACT_COMMITS = 160;
const IS_DEVELOPMENT = import.meta.env.DEV;
const listeners = new Set<() => void>();
const activeInteractions = new Map<string, InteractionTiming>();
const interactions: InteractionTiming[] = [];
const reactCommits: ReactCommitTiming[] = [];
let currentRoute = "startup";
let sequence = 0;
let profilingEnabled = false;

const notify = () => listeners.forEach((listener) => listener());

const markName = (id: string, stage: InteractionStage) => `shanghao:${id}:${stage}`;

const mark = (id: string, stage: InteractionStage, at = performance.now()): void => {
  if (!IS_DEVELOPMENT) return;
  const interaction = activeInteractions.get(id);
  if (!interaction || interaction.stages[stage] !== undefined) return;
  interaction.stages[stage] = at - interaction.startedAt;
  performance.mark(markName(id, stage), { startTime: at });
  if (stage === "page-interactive") {
    interaction.durationMs = at - interaction.startedAt;
  }
  notify();
};

const begin = (name: string, route = currentRoute): string => {
  if (!IS_DEVELOPMENT) return "disabled";
  const id = `${++sequence}-${name.replace(/[^a-z0-9-]/gi, "-")}`;
  const startedAt = performance.now();
  const interaction: InteractionTiming = {
    id,
    name,
    route,
    startedAt,
    stages: { "interaction-start": 0 },
  };
  activeInteractions.set(id, interaction);
  interactions.push(interaction);
  if (interactions.length > MAX_INTERACTIONS) {
    const removed = interactions.splice(0, interactions.length - MAX_INTERACTIONS);
    for (const item of removed) {
      activeInteractions.delete(item.id);
      for (const stage of Object.keys(item.stages) as InteractionStage[]) {
        performance.clearMarks(markName(item.id, stage));
      }
    }
  }
  performance.mark(markName(id, "interaction-start"), { startTime: startedAt });
  notify();
  return id;
};

const finish = (id: string, stage: InteractionStage = "page-interactive"): void => {
  mark(id, stage);
  const interaction = activeInteractions.get(id);
  if (!interaction) return;
  interaction.durationMs ??= performance.now() - interaction.startedAt;
  activeInteractions.delete(id);
  notify();
};

const afterNextPaint = (id: string): (() => void) => {
  if (!IS_DEVELOPMENT || id === "disabled") return () => undefined;
  let firstFrame = 0;
  let secondFrame = 0;
  firstFrame = window.requestAnimationFrame(() => {
    mark(id, "page-first-paint");
    secondFrame = window.requestAnimationFrame(() => finish(id));
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
  };
};

const snapshot = (): InteractionPerformanceSnapshot => {
  const memory = performance as Performance & { memory?: { usedJSHeapSize?: number } };
  const completed = [...interactions];
  const lastCompleted = [...completed]
    .reverse()
    .find((interaction) => interaction.durationMs !== undefined);
  return {
    capturedAt: performance.now(),
    route: currentRoute,
    domNodeCount: document.getElementsByTagName("*").length,
    jsHeapUsedBytes: memory.memory?.usedJSHeapSize,
    frame: rendererPerformanceMonitor.snapshot(),
    interactions: completed,
    reactCommits: [...reactCommits],
    lastInteractionLatencyMs: lastCompleted?.durationMs,
  };
};

export const interactionPerformanceMonitor = {
  begin,
  mark,
  finish,
  afterNextPaint,
  setRoute(route: string) {
    currentRoute = route;
    notify();
  },
  setProfilingEnabled(enabled: boolean) {
    profilingEnabled = enabled;
  },
  isProfilingEnabled: () => profilingEnabled,
  recordReactCommit(
    component: string,
    phase: "mount" | "update" | "nested-update",
    actualDurationMs: number,
    committedAt: number,
  ) {
    if (!profilingEnabled) return;
    reactCommits.push({ component, phase, actualDurationMs, committedAt });
    if (reactCommits.length > MAX_REACT_COMMITS) {
      reactCommits.splice(0, reactCommits.length - MAX_REACT_COMMITS);
    }
  },
  reset() {
    activeInteractions.clear();
    interactions.splice(0);
    reactCommits.splice(0);
    for (const entry of performance.getEntriesByType("mark")) {
      if (entry.name.startsWith("shanghao:")) performance.clearMarks(entry.name);
    }
    notify();
  },
  snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

if (IS_DEVELOPMENT) {
  const target = window as Window & {
    __shanghaoPerformance?: typeof interactionPerformanceMonitor;
  };
  target.__shanghaoPerformance = interactionPerformanceMonitor;
}
