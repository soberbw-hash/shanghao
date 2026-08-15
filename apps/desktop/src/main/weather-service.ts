import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  LocalWeatherRequest,
  LocalWeatherSnapshot,
  WeatherDayPhase,
  WeatherSceneKind,
} from "@private-voice/shared";

import {
  resolveAutomaticWeatherLocation,
  resolveManualWeatherLocation,
  resolveSystemWeatherLocation,
  type WeatherJsonFetcher,
  type WeatherLocation,
} from "./weather-location";

const WEATHER_REFRESH_MS = 25 * 60 * 1_000;
const LOCATION_REFRESH_MS = 24 * 60 * 60 * 1_000;
const WEATHER_CACHE_FILE = "local-weather-cache.json";

interface WeatherCacheFile {
  version: 1;
  locations: Record<string, WeatherLocation & { resolvedAt: string }>;
  snapshots: Record<string, LocalWeatherSnapshot>;
}

interface LocalWeatherServiceOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
  expectedCountryCode?: string;
}

const emptyCache = (): WeatherCacheFile => ({ version: 1, locations: {}, snapshots: {} });

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const readMinuteOfDay = (value?: string): number | undefined => {
  const time = value?.match(/(?:T|^)(\d{2}):(\d{2})/);
  if (!time) return undefined;
  return Number(time[1]) * 60 + Number(time[2]);
};

export const resolveWeatherScene = (weatherCode: number): WeatherSceneKind => {
  if (weatherCode === 0) return "clear";
  if (weatherCode === 1 || weatherCode === 2) return "partly_cloudy";
  if (weatherCode === 3) return "overcast";
  if (weatherCode === 45 || weatherCode === 48) return "fog";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snow";
  if ([95, 96, 99].includes(weatherCode)) return "thunderstorm";
  if ([55, 57, 65, 67, 82].includes(weatherCode)) return "heavy_rain";
  if ([51, 53, 56, 61, 63, 66, 80, 81].includes(weatherCode)) return "light_rain";
  return "partly_cloudy";
};

export const resolveWeatherDayPhase = ({
  localTime,
  sunrise,
  sunset,
  isDay,
}: {
  localTime?: string;
  sunrise?: string;
  sunset?: string;
  isDay?: number;
}): WeatherDayPhase => {
  const currentMinute = readMinuteOfDay(localTime);
  const sunriseMinute = readMinuteOfDay(sunrise);
  const sunsetMinute = readMinuteOfDay(sunset);
  if (
    currentMinute !== undefined &&
    sunriseMinute !== undefined &&
    Math.abs(currentMinute - sunriseMinute) <= 45
  )
    return "dawn";
  if (
    currentMinute !== undefined &&
    sunsetMinute !== undefined &&
    Math.abs(currentMinute - sunsetMinute) <= 55
  )
    return "dusk";
  if (isDay === 0) return "night";
  if (isDay === 1) return "day";
  if (currentMinute !== undefined)
    return currentMinute >= 6 * 60 && currentMinute < 18 * 60 ? "day" : "night";
  return "day";
};

const isFresh = (iso: string | undefined, now: Date, ttl: number): boolean => {
  const timestamp = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(timestamp) && now.getTime() - timestamp < ttl;
};

const normalizeRequest = (request: LocalWeatherRequest): LocalWeatherRequest => ({
  locationMode: request.locationMode === "manual" ? "manual" : "auto",
  manualCity: request.manualCity?.trim().slice(0, 80),
  systemPosition:
    request.locationMode !== "manual" &&
    Number.isFinite(request.systemPosition?.latitude) &&
    Number.isFinite(request.systemPosition?.longitude)
      ? {
          latitude: request.systemPosition!.latitude,
          longitude: request.systemPosition!.longitude,
          accuracyMeters: request.systemPosition?.accuracyMeters,
        }
      : undefined,
  forceRefresh: request.forceRefresh === true,
});

const locationCacheKey = (request: LocalWeatherRequest): string => {
  if (request.locationMode === "manual") {
    return `manual:${request.manualCity?.toLocaleLowerCase("zh-CN") ?? ""}`;
  }
  if (request.systemPosition) {
    return `auto:system:${request.systemPosition.latitude.toFixed(2)}:${request.systemPosition.longitude.toFixed(2)}`;
  }
  return "auto:ip";
};

const inferExpectedCountryCode = (): string | undefined => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return ["Asia/Shanghai", "Asia/Chongqing", "Asia/Harbin", "Asia/Urumqi"].includes(timeZone)
    ? "CN"
    : undefined;
};

export class LocalWeatherService {
  private readonly cachePath: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly expectedCountryCode?: string;
  private cache?: WeatherCacheFile;
  private pending = new Map<string, Promise<LocalWeatherSnapshot>>();

  constructor(userDataDirectory: string, options: LocalWeatherServiceOptions = {}) {
    this.cachePath = path.join(userDataDirectory, WEATHER_CACHE_FILE);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.expectedCountryCode = options.expectedCountryCode ?? inferExpectedCountryCode();
  }

  async getSnapshot(rawRequest: LocalWeatherRequest): Promise<LocalWeatherSnapshot> {
    const request = normalizeRequest(rawRequest);
    const key = locationCacheKey(request);
    const cache = await this.readCache();
    const cached = cache.snapshots[key];
    const now = this.now();
    if (!request.forceRefresh && cached && Date.parse(cached.expiresAt) > now.getTime()) {
      return { ...cached, source: "cache" };
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.loadLiveSnapshot(request, key, cached).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, task);
    return task;
  }

  private async loadLiveSnapshot(
    request: LocalWeatherRequest,
    key: string,
    stale?: LocalWeatherSnapshot,
  ): Promise<LocalWeatherSnapshot> {
    let resolvedCity: string | undefined;
    let resolvedLocationSource: LocalWeatherSnapshot["locationSource"];
    try {
      const cache = await this.readCache();
      const now = this.now();
      let location = cache.locations[key];
      if (!location || !isFresh(location.resolvedAt, now, LOCATION_REFRESH_MS)) {
        const fetchJson: WeatherJsonFetcher = (url) => this.fetchJson(url);
        const resolved = request.systemPosition
          ? resolveSystemWeatherLocation(request.systemPosition)
          : request.locationMode === "manual"
            ? await resolveManualWeatherLocation(request.manualCity ?? "", fetchJson)
            : await resolveAutomaticWeatherLocation(fetchJson, {
                expectedCountryCode: this.expectedCountryCode,
              });
        location = { ...resolved, resolvedAt: now.toISOString() };
        cache.locations[key] = location;
      }
      resolvedCity = location.city;
      resolvedLocationSource = location.source;
      const payload = readRecord(await this.fetchJson(this.createForecastUrl(location)));
      const current = readRecord(payload?.current);
      const daily = readRecord(payload?.daily);
      const weatherCode = finiteNumber(current?.weather_code);
      if (weatherCode === undefined) throw new Error("weather_forecast_invalid");
      const sunrise = Array.isArray(daily?.sunrise) ? text(daily?.sunrise[0]) : undefined;
      const sunset = Array.isArray(daily?.sunset) ? text(daily?.sunset[0]) : undefined;
      const localTime = text(current?.time);
      const fetchedAt = now.toISOString();
      const snapshot: LocalWeatherSnapshot = {
        scene: resolveWeatherScene(weatherCode),
        phase: resolveWeatherDayPhase({
          localTime,
          sunrise,
          sunset,
          isDay: finiteNumber(current?.is_day),
        }),
        city: location.city,
        temperatureC: finiteNumber(current?.temperature_2m),
        weatherCode,
        cloudCover: finiteNumber(current?.cloud_cover),
        precipitationMm: finiteNumber(current?.precipitation),
        visibilityMeters: finiteNumber(current?.visibility),
        localTime,
        sunrise,
        sunset,
        fetchedAt,
        expiresAt: new Date(now.getTime() + WEATHER_REFRESH_MS).toISOString(),
        source: "live",
        locationSource: location.source,
      };
      cache.snapshots[key] = snapshot;
      await this.writeCache(cache);
      return snapshot;
    } catch {
      if (stale) return { ...stale, source: "cache" };
      const now = this.now();
      return {
        scene: "clear",
        phase: resolveWeatherDayPhase({
          localTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
        }),
        city: resolvedCity,
        fetchedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + WEATHER_REFRESH_MS).toISOString(),
        source: "fallback",
        locationSource: resolvedLocationSource,
      };
    }
  }

  private createForecastUrl(location: WeatherLocation): string {
    const parameters = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current:
        "temperature_2m,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,visibility",
      daily: "sunrise,sunset",
      timezone: "auto",
      forecast_days: "1",
    });
    return `https://api.open-meteo.com/v1/forecast?${parameters.toString()}`;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "ShangHao-Weather/1" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`weather_request_${response.status}`);
    return response.json();
  }

  private async readCache(): Promise<WeatherCacheFile> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, "utf8")) as WeatherCacheFile;
      this.cache =
        parsed?.version === 1 && parsed.locations && parsed.snapshots ? parsed : emptyCache();
    } catch {
      this.cache = emptyCache();
    }
    return this.cache;
  }

  private async writeCache(cache: WeatherCacheFile): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache, null, 2), "utf8");
  }
}
