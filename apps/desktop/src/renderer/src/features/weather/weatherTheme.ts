import type {
  LocalWeatherSnapshot,
  WeatherDayPhase,
  WeatherSceneKind,
} from "@private-voice/shared";

export type WeatherRoomTone = "bright" | "neutral" | "cool" | "storm" | "snow" | "night";

export interface WeatherVisualTheme {
  scene: WeatherSceneKind;
  phase: WeatherDayPhase;
  roomTone: WeatherRoomTone;
  label: string;
  hasClouds: boolean;
  hasRain: boolean;
  hasSnow: boolean;
  hasFog: boolean;
  hasLightning: boolean;
}

const SCENE_LABELS: Record<WeatherSceneKind, string> = {
  clear: "晴朗",
  partly_cloudy: "多云",
  overcast: "阴天",
  light_rain: "小雨",
  heavy_rain: "大雨",
  thunderstorm: "雷雨",
  snow: "下雪",
  fog: "雾",
};

export const resolveWeatherVisualTheme = (snapshot?: LocalWeatherSnapshot): WeatherVisualTheme => {
  const scene = snapshot?.scene ?? "clear";
  const phase = snapshot?.phase ?? "day";
  const isNight = phase === "night";
  const roomTone: WeatherRoomTone = isNight
    ? "night"
    : scene === "clear"
      ? "bright"
      : scene === "partly_cloudy"
        ? "neutral"
        : scene === "snow"
          ? "snow"
          : scene === "heavy_rain" || scene === "thunderstorm"
            ? "storm"
            : "cool";
  return {
    scene,
    phase,
    roomTone,
    label: `${phase === "night" && scene === "clear" ? "晴朗夜晚" : SCENE_LABELS[scene]}`,
    hasClouds: ["partly_cloudy", "overcast", "light_rain", "heavy_rain", "thunderstorm"].includes(
      scene,
    ),
    hasRain: ["light_rain", "heavy_rain", "thunderstorm"].includes(scene),
    hasSnow: scene === "snow",
    hasFog: scene === "fog",
    hasLightning: scene === "thunderstorm",
  };
};
