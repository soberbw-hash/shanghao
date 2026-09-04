import { useEffect, useState } from "react";

import { interactionPerformanceMonitor } from "../../features/diagnostics/interactionPerformanceMonitor";
import { rendererPerformanceMonitor } from "../../features/diagnostics/rendererPerformanceMonitor";

const STORAGE_KEY = "shanghao.dev.performance-monitor";

const shouldStartEnabled = (): boolean => {
  if (!import.meta.env.DEV) return false;
  const query = new URLSearchParams(window.location.search);
  return (
    query.get("performanceMonitor") === "1" || window.localStorage.getItem(STORAGE_KEY) === "1"
  );
};

const formatBytes = (value?: number) =>
  value === undefined ? "--" : `${(value / 1024 / 1024).toFixed(1)} MB`;

export const InteractionPerformanceHud = ({ route }: { route: string }) => {
  const [enabled, setEnabled] = useState(shouldStartEnabled);
  const [snapshot, setSnapshot] = useState(() => interactionPerformanceMonitor.snapshot());

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const toggle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && event.shiftKey && event.altKey && event.code === "KeyP")) return;
      event.preventDefault();
      setEnabled((current) => {
        const next = !current;
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        return next;
      });
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, []);

  useEffect(() => {
    interactionPerformanceMonitor.setRoute(route);
  }, [route]);

  useEffect(() => {
    if (!enabled || !import.meta.env.DEV) {
      interactionPerformanceMonitor.setProfilingEnabled(false);
      return;
    }
    interactionPerformanceMonitor.setProfilingEnabled(true);
    const stopMonitor = rendererPerformanceMonitor.start();
    const refresh = () => setSnapshot(interactionPerformanceMonitor.snapshot());
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => {
      window.clearInterval(timer);
      stopMonitor();
      interactionPerformanceMonitor.setProfilingEnabled(false);
    };
  }, [enabled]);

  if (!import.meta.env.DEV || !enabled) return null;
  const lastInteraction = snapshot.interactions.at(-1);
  const renderCounts = snapshot.frame.componentRenderCounts ?? {};
  const settingsRenders = renderCounts.SettingsPage ?? 0;
  const aiRenders = renderCounts.AiVoiceMemorySettingsCard ?? 0;

  return (
    <aside className="interaction-performance-hud" aria-label="开发性能监控">
      <strong>PERF · {snapshot.route}</strong>
      <span>
        FPS {snapshot.frame.actualFps?.toFixed(0) ?? "--"} · p95{" "}
        {snapshot.frame.frameTimeP95Ms?.toFixed(1) ?? "--"} ms · p99{" "}
        {snapshot.frame.frameTimeP99Ms?.toFixed(1) ?? "--"} ms
      </span>
      <span>
        Long {snapshot.frame.longTaskCount} / {snapshot.frame.longFrameCount} · DOM{" "}
        {snapshot.domNodeCount} · Heap {formatBytes(snapshot.jsHeapUsedBytes)}
      </span>
      <span>
        Renders settings {settingsRenders} · AI {aiRenders}
      </span>
      <span>
        Last {lastInteraction?.name ?? "--"} · {lastInteraction?.durationMs?.toFixed(1) ?? "--"} ms
      </span>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem(STORAGE_KEY, "0");
          setEnabled(false);
        }}
      >
        关闭
      </button>
    </aside>
  );
};
