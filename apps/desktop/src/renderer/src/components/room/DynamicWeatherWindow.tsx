import { useEffect, useMemo, type CSSProperties } from "react";

import { cn } from "@private-voice/ui";
import type { WeatherLocationMode } from "@private-voice/shared";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useVisibleInterval, useVisualVisibility } from "../../hooks/useVisualVisibility";
import { resolveWeatherVisualTheme } from "../../features/weather/weatherTheme";
import { useWeatherStore } from "../../features/weather/weatherStore";
import windowAsset from "../../assets/scenes/shanghao-room/window-frame-v2.png";
import dayView from "../../assets/scenes/shanghao-room/weather-day.png";
import cloudyView from "../../assets/scenes/shanghao-room/weather-cloudy.png";
import rainView from "../../assets/scenes/shanghao-room/weather-rain.png";
import snowView from "../../assets/scenes/shanghao-room/weather-snow.png";
import nightView from "../../assets/scenes/shanghao-room/weather-night.png";

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
  const landscape = theme.hasSnow
    ? snowView
    : theme.hasRain
      ? rainView
      : theme.phase === "night"
        ? nightView
        : theme.scene === "overcast" || theme.hasFog
          ? cloudyView
          : dayView;
  const rainDrops = theme.scene === "heavy_rain" || theme.hasLightning ? 14 : 9;
  const snowflakes = 11;
  const showNightDetails =
    isEnabled &&
    theme.phase === "night" &&
    (theme.scene === "clear" || theme.scene === "partly_cloudy");
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
      <img
        className="weather-window-art"
        src={windowAsset}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <div key={`${theme.scene}:${theme.phase}`} className="weather-window-view">
        <img className="weather-landscape" src={landscape} alt="" aria-hidden="true" />
        {showNightDetails ? (
          <div className="weather-night-details" aria-hidden="true">
            <span className="weather-night-moonlight" />
            {Array.from({ length: 7 }, (_, index) => (
              <span className="weather-night-star" key={index} />
            ))}
            <span className="weather-night-city-glimmer" />
          </div>
        ) : null}
        {isEnabled ? <span className="weather-atmosphere-glow" aria-hidden="true" /> : null}
        {isEnabled && (theme.hasClouds || (theme.scene === "clear" && theme.phase !== "night")) ? (
          <div className="weather-cloud-layer" aria-hidden="true">
            <span className="weather-cloud weather-cloud-one" />
            <span className="weather-cloud weather-cloud-two" />
          </div>
        ) : null}
        {isEnabled && theme.hasRain ? (
          <div className="weather-rain-layer" aria-hidden="true">
            {Array.from({ length: rainDrops }, (_, index) => (
              <span key={index} style={{ "--weather-index": index } as CSSProperties} />
            ))}
          </div>
        ) : null}
        {isEnabled && theme.hasSnow ? (
          <div className="weather-snow-layer" aria-hidden="true">
            {Array.from({ length: snowflakes }, (_, index) => (
              <span key={index} style={{ "--weather-index": index } as CSSProperties} />
            ))}
          </div>
        ) : null}
        {isEnabled && theme.hasFog ? (
          <div className="weather-fog-layer" aria-hidden="true" />
        ) : null}
        {isEnabled && theme.hasLightning ? (
          <div className="weather-lightning" aria-hidden="true" />
        ) : null}
      </div>
      <span className="scene-ambient-tooltip weather-window-tooltip" aria-hidden="true">
        {weatherTooltip}
      </span>
    </div>
  );
};
