import { useEffect } from "react";

import type { AppSettings } from "@private-voice/shared";

import { SettingsItemRow } from "./SettingsItemRow";
import { useWeatherStore } from "../../features/weather/weatherStore";
import { WeatherCityPicker } from "./WeatherCityPicker";

export const WeatherSettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => {
  const snapshot = useWeatherStore((state) => state.snapshot);
  const snapshotRequestKey = useWeatherStore((state) => state.snapshotRequestKey);
  const isLoading = useWeatherStore((state) => state.isLoading);
  const error = useWeatherStore((state) => state.error);
  const refresh = useWeatherStore((state) => state.refresh);
  const detectedCity = snapshotRequestKey?.startsWith("auto:") ? snapshot?.city?.trim() : undefined;
  const savedCity = settings.weatherManualCity.trim();
  const locationDescription =
    settings.weatherLocationMode === "manual"
      ? `当前选择：${savedCity || "尚未选择城市"}`
      : detectedCity
        ? `${snapshot?.locationSource === "system" ? "系统定位" : "网络定位"}到：${detectedCity}。如果不对，可搜索或输入任意地点。`
        : snapshot?.locationSource === "system"
          ? "已获取系统位置，城市名称暂不可用；可手动选择城市。"
          : isLoading
            ? settings.isSystemWeatherLocationEnabled
              ? "正在请求 Windows 系统定位…"
              : "正在获取网络大致位置…"
            : error || snapshot?.source === "fallback"
              ? "天气位置暂时不可用；可搜索或输入地点。"
              : settings.isSystemWeatherLocationEnabled
                ? "使用 Windows 系统定位；不可用时回退到网络大致位置。"
                : "使用网络大致位置；也可以手动选择城市。";

  useEffect(() => {
    void refresh({
      locationMode: settings.weatherLocationMode,
      manualCity: settings.weatherManualCity,
      useSystemLocation: settings.isSystemWeatherLocationEnabled,
    }).catch(() => undefined);
  }, [
    refresh,
    settings.weatherLocationMode,
    settings.weatherManualCity,
    settings.isSystemWeatherLocationEnabled,
  ]);

  return (
    <div className="weather-settings-block space-y-3" aria-label="天气设置">
      <SettingsItemRow label="天气位置" description={locationDescription}>
        <WeatherCityPicker
          selectedCity={settings.weatherLocationMode === "manual" ? savedCity : undefined}
          detectedCity={detectedCity}
          isLoading={isLoading}
          isSystemLocationEnabled={settings.isSystemWeatherLocationEnabled}
          onSelect={(city) => {
            const weatherManualCity = city?.trim().slice(0, 80) ?? "";
            onChange(
              weatherManualCity
                ? { weatherLocationMode: "manual", weatherManualCity }
                : { weatherLocationMode: "auto", weatherManualCity: "" },
            );
          }}
        />
      </SettingsItemRow>
    </div>
  );
};
