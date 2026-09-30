import { useEffect } from "react";

import type { AppSettings } from "@private-voice/shared";

import { SettingsItemRow } from "./SettingsItemRow";
import { Switch } from "../base/Switch";
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
  const preview = useWeatherStore((state) => state.preview);
  const refresh = useWeatherStore((state) => state.refresh);
  const setPreview = useWeatherStore((state) => state.setPreview);
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
      {settings.weatherLocationMode === "auto" ? (
        <SettingsItemRow
          label="Windows 精确定位"
          description="仅在你开启后读取系统位置，用于获取天气和城市名称；关闭时使用网络大致定位。"
        >
          <Switch
            ariaLabel="Windows 精确定位"
            isChecked={settings.isSystemWeatherLocationEnabled}
            onChange={(isSystemWeatherLocationEnabled) =>
              onChange({ isSystemWeatherLocationEnabled })
            }
          />
        </SettingsItemRow>
      ) : null}
      {import.meta.env.DEV ? (
        <SettingsItemRow label="本地天气预览" description="仅开发模式可见，不会保存或联网。">
          <select
            value={preview ? `${preview.scene}:${preview.phase}` : "live"}
            className="settings-inline-select"
            aria-label="本地天气预览"
            onChange={(event) => {
              if (event.target.value === "live") {
                setPreview(undefined);
                return;
              }
              const [scene, phase] = event.target.value.split(":") as [
                NonNullable<typeof preview>["scene"],
                NonNullable<typeof preview>["phase"],
              ];
              setPreview({ scene, phase });
            }}
          >
            <option value="live">实时天气</option>
            <option value="clear:day">晴天</option>
            <option value="overcast:day">阴天</option>
            <option value="light_rain:day">小雨</option>
            <option value="heavy_rain:day">大雨</option>
            <option value="thunderstorm:day">雷雨</option>
            <option value="snow:day">下雪</option>
            <option value="fog:day">雾 / 霾</option>
            <option value="clear:dawn">清晨</option>
            <option value="clear:dusk">傍晚</option>
            <option value="clear:night">晴朗夜晚</option>
          </select>
        </SettingsItemRow>
      ) : null}
    </div>
  );
};
