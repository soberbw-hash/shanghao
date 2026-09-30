import { useEffect } from "react";

import { preloadWeatherSceneAssets } from "../features/weather/weatherPreload";
import { useWeatherStore } from "../features/weather/weatherStore";
import { useSettingsStore } from "../store/settingsStore";

export const useWeatherPreload = (): void => {
  const enabled = useSettingsStore((state) => state.settings?.isDynamicWeatherEnabled);
  const locationMode = useSettingsStore((state) => state.settings?.weatherLocationMode ?? "auto");
  const manualCity = useSettingsStore((state) => state.settings?.weatherManualCity ?? "");
  const useSystemLocation = useSettingsStore(
    (state) => state.settings?.isSystemWeatherLocationEnabled === true,
  );

  useEffect(() => {
    if (enabled !== true) return;
    // Settings hydrate before the login form is shown, so this work can finish
    // while the user is entering credentials instead of after joining a room.
    void preloadWeatherSceneAssets();
    void useWeatherStore
      .getState()
      .refresh({ locationMode, manualCity, useSystemLocation })
      .catch(() => undefined);
  }, [enabled, locationMode, manualCity, useSystemLocation]);
};
