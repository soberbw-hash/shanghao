import { useEffect } from "react";
import { Sparkles } from "lucide-react";

import type { AppSettings } from "@private-voice/shared";

import { Switch } from "../base/Switch";
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
  const preview = useWeatherStore((state) => state.preview);
  const refresh = useWeatherStore((state) => state.refresh);
  const setPreview = useWeatherStore((state) => state.setPreview);
  const detectedCity = snapshotRequestKey === "auto" ? snapshot?.city?.trim() : undefined;
  const savedCity = settings.weatherManualCity.trim();
  const locationDescription =
    settings.weatherLocationMode === "manual"
      ? `当前选择：${savedCity || "尚未选择城市"}`
      : detectedCity
        ? `${snapshot?.locationSource === "system" ? "系统定位" : "网络定位"}到：${detectedCity}。如果不对，可搜索或输入任意地点。`
        : snapshot?.locationSource === "system"
          ? "已通过 Windows 系统定位获取当前位置。"
          : isLoading
            ? "正在请求 Windows 系统定位…"
            : error || snapshot?.source === "fallback"
              ? "系统定位不可用，且网络定位失败；可搜索或输入地点。"
              : "优先使用 Windows 系统定位；不可用时才回退到网络定位。";

  useEffect(() => {
    if (!settings.isDynamicWeatherEnabled) return;
    void refresh({
      locationMode: settings.weatherLocationMode,
      manualCity: settings.weatherManualCity,
    }).catch(() => undefined);
  }, [
    refresh,
    settings.isDynamicWeatherEnabled,
    settings.weatherLocationMode,
    settings.weatherManualCity,
  ]);

  return (
    <div className="weather-settings-block space-y-3" aria-label="窗外天气设置">
      <SettingsItemRow
        label="窗外天气"
        description="按本地城市的天气和昼夜轻微改变窗外与房间光线。"
      >
        <Switch
          isChecked={settings.isDynamicWeatherEnabled}
          onChange={(isDynamicWeatherEnabled) => onChange({ isDynamicWeatherEnabled })}
        />
      </SettingsItemRow>
      {settings.isDynamicWeatherEnabled ? (
        <>
          <SettingsItemRow label="天气位置" description={locationDescription}>
            <WeatherCityPicker
              selectedCity={settings.weatherLocationMode === "manual" ? savedCity : undefined}
              detectedCity={detectedCity}
              isLoading={isLoading}
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
          <SettingsItemRow label="动态效果" description="省资源模式会减少雨滴、雪花和云层动画。">
            <div className="weather-location-controls">
              <Sparkles size={16} aria-hidden="true" />
              <select
                value={settings.weatherEffectMode}
                className="settings-inline-select"
                aria-label="天气动态效果"
                onChange={(event) =>
                  onChange({
                    weatherEffectMode: event.target.value === "reduced" ? "reduced" : "standard",
                  })
                }
              >
                <option value="standard">标准</option>
                <option value="reduced">省资源</option>
              </select>
            </div>
          </SettingsItemRow>
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
        </>
      ) : null}
    </div>
  );
};
