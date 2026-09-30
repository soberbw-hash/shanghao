import type { LocalWeatherSnapshot } from "@private-voice/shared";

import windowAsset from "../../assets/scenes/shanghao-room/window-frame-v2.png";
import roomEnvironment from "../../assets/scenes/shanghao-room/environment-v3-extended.png";
import dayView from "../../assets/scenes/shanghao-room/weather-day.png";
import cloudyView from "../../assets/scenes/shanghao-room/weather-cloudy.png";
import rainView from "../../assets/scenes/shanghao-room/weather-rain.png";
import snowView from "../../assets/scenes/shanghao-room/weather-snow.png";
import nightView from "../../assets/scenes/shanghao-room/weather-night.png";
import { resolveWeatherVisualTheme } from "./weatherTheme";

const pendingImages = new Map<string, Promise<void>>();

const preloadImage = (url: string): Promise<void> => {
  if (typeof Image === "undefined") return Promise.resolve();
  const existing = pendingImages.get(url);
  if (existing) return existing;

  const task = new Promise<void>((resolve) => {
    const image = new Image();
    const timer = globalThis.setTimeout(() => resolve(), 2_500);
    const finish = () => {
      globalThis.clearTimeout(timer);
      resolve();
    };
    image.onload = () => {
      if (typeof image.decode === "function") {
        void image
          .decode()
          .catch(() => undefined)
          .then(finish);
      } else {
        finish();
      }
    };
    image.onerror = finish;
    image.src = url;
  });
  pendingImages.set(url, task);
  return task;
};

export const preloadWeatherSceneAssets = (
  snapshot?: Pick<LocalWeatherSnapshot, "scene" | "phase">,
): Promise<void> => {
  const theme = resolveWeatherVisualTheme(snapshot);
  const landscape = theme.hasSnow
    ? snowView
    : theme.hasRain
      ? rainView
      : theme.phase === "night"
        ? nightView
        : theme.scene === "overcast" || theme.hasFog
          ? cloudyView
          : dayView;

  return Promise.all([windowAsset, roomEnvironment, landscape].map(preloadImage)).then(
    () => undefined,
  );
};
