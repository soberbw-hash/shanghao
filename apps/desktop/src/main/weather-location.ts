export interface WeatherLocation {
  city?: string;
  latitude: number;
  longitude: number;
  source: "system" | "ip" | "manual";
}

export type WeatherJsonFetcher = (url: string) => Promise<unknown>;

export interface AutomaticWeatherLocationOptions {
  expectedCountryCode?: string;
}

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asText = (value: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
};

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const resolveAutomaticWeatherLocation = async (
  fetchJson: WeatherJsonFetcher,
  options: AutomaticWeatherLocationOptions = {},
): Promise<WeatherLocation> => {
  const expectedCountryCode = options.expectedCountryCode?.trim().toUpperCase();
  const endpoints = [
    "https://ipwho.is/?fields=success,city,region,country,country_code,latitude,longitude",
    "https://ipapi.co/json/",
  ];
  for (const endpoint of endpoints) {
    try {
      const payload = readRecord(await fetchJson(endpoint));
      if (!payload || payload.success === false) continue;
      const countryCode = asText(payload.country_code)?.toUpperCase();
      if (expectedCountryCode && countryCode && countryCode !== expectedCountryCode) continue;
      const latitude = asFiniteNumber(payload.latitude);
      const longitude = asFiniteNumber(payload.longitude);
      if (latitude === undefined || longitude === undefined) continue;
      return {
        city: asText(payload.city) ?? asText(payload.region) ?? asText(payload.country),
        latitude,
        longitude,
        source: "ip",
      };
    } catch {
      // Try the next coarse-IP provider before the weather service falls back to cache.
    }
  }
  throw new Error("weather_ip_location_failed");
};

export const resolveManualWeatherLocation = async (
  city: string,
  fetchJson: WeatherJsonFetcher,
): Promise<WeatherLocation> => {
  const normalizedCity = city.trim().slice(0, 80);
  if (!normalizedCity) throw new Error("weather_manual_city_required");
  const payload = readRecord(
    await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        normalizedCity,
      )}&count=5&language=zh&format=json`,
    ),
  );
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const result = readRecord(results[0]);
  const latitude = asFiniteNumber(result?.latitude);
  const longitude = asFiniteNumber(result?.longitude);
  if (latitude === undefined || longitude === undefined) {
    throw new Error("weather_manual_city_not_found");
  }
  return {
    city: asText(result?.name) ?? normalizedCity,
    latitude,
    longitude,
    source: "manual",
  };
};

export const resolveSystemWeatherLocation = ({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): WeatherLocation => {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("weather_system_location_invalid");
  }
  return { latitude, longitude, source: "system" };
};
