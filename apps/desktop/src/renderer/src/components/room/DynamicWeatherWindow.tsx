import { useEffect, useMemo, type CSSProperties } from "react";

import { cn } from "@private-voice/ui";
import type { WeatherLocationMode } from "@private-voice/shared";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useVisibleInterval, useVisualVisibility } from "../../hooks/useVisualVisibility";
import { resolveWeatherVisualTheme } from "../../features/weather/weatherTheme";
import { useWeatherStore } from "../../features/weather/weatherStore";

const REFRESH_INTERVAL_MS = 25 * 60 * 1_000;

export const DynamicWeatherWindow = ({
  isEnabled,
  locationMode,
  manualCity,
}: {
  isEnabled: boolean;
  locationMode: WeatherLocationMode;
  manualCity: string;
}) => {
  const snapshot = useWeatherStore((state) => state.snapshot);
  const preview = useWeatherStore((state) => state.preview);
  const refresh = useWeatherStore((state) => state.refresh);
  const clear = useWeatherStore((state) => state.clear);
  const isPageVisible = useVisualVisibility();
  const reduceMotion = usePrefersReducedMotion();
  const request = useMemo(() => ({ locationMode, manualCity }), [locationMode, manualCity]);

  useEffect(() => {
    if (!isEnabled) {
      clear();
      return;
    }
    void refresh(request).catch(() => undefined);
  }, [clear, isEnabled, refresh, request]);

  useVisibleInterval(() => {
    if (isEnabled) void refresh({ ...request, forceRefresh: true }).catch(() => undefined);
  }, REFRESH_INTERVAL_MS);

  const visualSnapshot = preview
    ? {
        ...snapshot,
        ...preview,
        fetchedAt: snapshot?.fetchedAt ?? "",
        expiresAt: snapshot?.expiresAt ?? "",
        source: snapshot?.source ?? "fallback",
      }
    : snapshot;
  const theme = resolveWeatherVisualTheme(isEnabled ? visualSnapshot : undefined);
  const isMotionPaused = reduceMotion || !isPageVisible;
  const rainDrops = theme.scene === "heavy_rain" || theme.hasLightning ? 14 : 9;
  const snowflakes = 11;
  const temperatureLabel =
    typeof visualSnapshot?.temperatureC === "number"
      ? `${Math.round(visualSnapshot.temperatureC)}°C`
      : undefined;
  const weatherTooltip = [visualSnapshot?.city?.trim() || "当地", theme.label, temperatureLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "dynamic-weather-window",
        `weather-scene-${theme.scene}`,
        `weather-phase-${theme.phase}`,
        isMotionPaused && "is-motion-paused",
      )}
      role="img"
      aria-label={`窗外${theme.label}${snapshot?.city ? `，${snapshot.city}` : ""}`}
      data-weather-source={snapshot?.source ?? "fallback"}
    >
      <div key={`${theme.scene}:${theme.phase}`} className="weather-window-view">
        <div className="weather-sky-orb" />
        <div className="weather-distant-silhouette">
          <span />
          <span />
          <span />
          <span />
        </div>
        {theme.hasClouds ? (
          <div className="weather-cloud-layer" aria-hidden="true">
            <span className="weather-cloud weather-cloud-one" />
            <span className="weather-cloud weather-cloud-two" />
          </div>
        ) : null}
        {theme.hasRain ? (
          <div className="weather-rain-layer" aria-hidden="true">
            {Array.from({ length: rainDrops }, (_, index) => (
              <span key={index} style={{ "--weather-index": index } as CSSProperties} />
            ))}
          </div>
        ) : null}
        {theme.hasSnow ? (
          <div className="weather-snow-layer" aria-hidden="true">
            {Array.from({ length: snowflakes }, (_, index) => (
              <span key={index} style={{ "--weather-index": index } as CSSProperties} />
            ))}
          </div>
        ) : null}
        {theme.hasFog ? <div className="weather-fog-layer" aria-hidden="true" /> : null}
        {theme.hasLightning ? <div className="weather-lightning" aria-hidden="true" /> : null}
      </div>
      <div className="weather-window-frame" aria-hidden="true">
        <span className="weather-window-mullion" />
        <span className="weather-window-sill" />
      </div>
      <div className="weather-window-plants" aria-hidden="true">
        <span className="weather-plant weather-plant-left" />
        <span className="weather-plant weather-plant-right" />
      </div>
      <span className="scene-ambient-tooltip weather-window-tooltip" aria-hidden="true">
        {weatherTooltip}
      </span>
    </div>
  );
};
