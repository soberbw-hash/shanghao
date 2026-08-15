export type WeatherLocationMode = "auto" | "manual";
export type WeatherEffectMode = "standard" | "reduced";

export type WeatherSceneKind =
  | "clear"
  | "partly_cloudy"
  | "overcast"
  | "light_rain"
  | "heavy_rain"
  | "thunderstorm"
  | "snow"
  | "fog";

export type WeatherDayPhase = "dawn" | "day" | "dusk" | "night";
export type WeatherSnapshotSource = "live" | "cache" | "fallback";
export type WeatherLocationSource = "system" | "ip" | "manual";

export interface SystemWeatherPosition {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export interface LocalWeatherRequest {
  locationMode: WeatherLocationMode;
  manualCity?: string;
  systemPosition?: SystemWeatherPosition;
  forceRefresh?: boolean;
}

export interface LocalWeatherSnapshot {
  scene: WeatherSceneKind;
  phase: WeatherDayPhase;
  city?: string;
  temperatureC?: number;
  weatherCode?: number;
  cloudCover?: number;
  precipitationMm?: number;
  visibilityMeters?: number;
  localTime?: string;
  sunrise?: string;
  sunset?: string;
  fetchedAt: string;
  expiresAt: string;
  source: WeatherSnapshotSource;
  locationSource?: WeatherLocationSource;
}
