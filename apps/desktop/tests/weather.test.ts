import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveAutomaticWeatherLocation,
  resolveSystemWeatherLocation,
} from "../src/main/weather-location";
import {
  LocalWeatherService,
  resolveWeatherDayPhase,
  resolveWeatherScene,
} from "../src/main/weather-service";
import { resolveWeatherVisualTheme } from "../src/renderer/src/features/weather/weatherTheme";
import {
  CHINA_CITY_NAMES,
  CHINA_CITY_REGION_GROUPS,
  CHINA_POPULAR_CITY_NAMES,
} from "../src/renderer/src/features/weather/chinaCities";

test("weather city search covers nationwide city-level and county-level cities", () => {
  assert.equal(CHINA_CITY_NAMES.length >= 700, true);
  for (const city of [
    "北京市",
    "杭州市",
    "三沙市",
    "喀什地区",
    "阿坝藏族羌族自治州",
    "五指山市",
    "北屯市",
    "香港特别行政区",
    "澳门特别行政区",
    "台北市",
  ]) {
    assert.equal(CHINA_CITY_NAMES.includes(city), true, `missing weather city: ${city}`);
  }
});

test("weather city picker groups every searchable city without dropping or duplicating entries", () => {
  const groupedCities = CHINA_CITY_REGION_GROUPS.flatMap((group) => group.cities);
  assert.deepEqual(groupedCities, [...CHINA_CITY_NAMES]);
  assert.equal(new Set(groupedCities).size, CHINA_CITY_NAMES.length);
  for (const city of CHINA_POPULAR_CITY_NAMES) {
    assert.equal(CHINA_CITY_NAMES.includes(city), true, `popular city is not searchable: ${city}`);
  }
});

test("WMO weather codes map to the supported room scenes", () => {
  assert.equal(resolveWeatherScene(0), "clear");
  assert.equal(resolveWeatherScene(2), "partly_cloudy");
  assert.equal(resolveWeatherScene(3), "overcast");
  assert.equal(resolveWeatherScene(45), "fog");
  assert.equal(resolveWeatherScene(61), "light_rain");
  assert.equal(resolveWeatherScene(65), "heavy_rain");
  assert.equal(resolveWeatherScene(95), "thunderstorm");
  assert.equal(resolveWeatherScene(75), "snow");
});

test("local sunrise and sunset create gentle dawn and dusk phases", () => {
  assert.equal(
    resolveWeatherDayPhase({
      localTime: "2026-08-14T06:18",
      sunrise: "2026-08-14T05:51",
      sunset: "2026-08-14T18:42",
      isDay: 1,
    }),
    "dawn",
  );
  assert.equal(
    resolveWeatherDayPhase({
      localTime: "2026-08-14T18:23",
      sunrise: "2026-08-14T05:51",
      sunset: "2026-08-14T18:42",
      isDay: 1,
    }),
    "dusk",
  );
  assert.equal(resolveWeatherDayPhase({ localTime: "2026-08-14T23:30", isDay: 0 }), "night");
});

test("automatic city resolution falls back to a second coarse IP provider", async () => {
  const requested: string[] = [];
  const location = await resolveAutomaticWeatherLocation(async (url) => {
    requested.push(url);
    if (requested.length === 1) throw new Error("primary unavailable");
    return { city: "Hangzhou", latitude: 30.27, longitude: 120.15 };
  });

  assert.equal(location.city, "Hangzhou");
  assert.equal(requested.length, 2);
});

test("automatic city resolution rejects a foreign VPN exit for a China-timezone device", async () => {
  const requested: string[] = [];
  const location = await resolveAutomaticWeatherLocation(
    async (url) => {
      requested.push(url);
      return requested.length === 1
        ? {
            city: "Los Angeles",
            country_code: "US",
            latitude: 34.05,
            longitude: -118.24,
          }
        : { city: "杭州", country_code: "CN", latitude: 30.27, longitude: 120.15 };
    },
    { expectedCountryCode: "CN" },
  );

  assert.equal(location.city, "杭州");
  assert.equal(requested.length, 2);
});

test("system coordinates are validated without consulting an IP location provider", () => {
  assert.deepEqual(resolveSystemWeatherLocation({ latitude: 22.5431, longitude: 114.0579 }), {
    latitude: 22.5431,
    longitude: 114.0579,
    source: "system",
  });
  assert.throws(
    () => resolveSystemWeatherLocation({ latitude: 120, longitude: 114.0579 }),
    /weather_system_location_invalid/,
  );
});

test("weather IPC uses a proxy-free network session", async () => {
  const source = await readFile(path.resolve(process.cwd(), "src/main/ipc.ts"), "utf8");
  assert.equal(source.includes('session.fromPartition("shanghao-weather-direct"'), true);
  assert.equal(source.includes('weatherSession.setProxy({ mode: "direct" })'), true);
  assert.equal(source.includes("weatherSession.fetch"), true);
});

test("weather service caches locally and never exposes coordinates to the renderer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-weather-"));
  let requestCount = 0;
  const fetcher: typeof fetch = async (input) => {
    requestCount += 1;
    const url = String(input);
    const body = url.includes("ipwho")
      ? { success: true, city: "杭州", latitude: 30.27, longitude: 120.15 }
      : {
          current: {
            time: "2026-08-14T20:10",
            temperature_2m: 27.3,
            is_day: 0,
            precipitation: 0,
            weather_code: 0,
            cloud_cover: 5,
            visibility: 18_000,
          },
          daily: {
            sunrise: ["2026-08-14T05:23"],
            sunset: ["2026-08-14T18:39"],
          },
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const service = new LocalWeatherService(directory, {
    fetcher,
    now: () => new Date("2026-08-14T12:10:00.000Z"),
  });
  const first = await service.getSnapshot({ locationMode: "auto" });
  const second = await service.getSnapshot({ locationMode: "auto" });

  assert.equal(first.scene, "clear");
  assert.equal(first.phase, "night");
  assert.equal(first.city, "杭州");
  assert.equal(first.locationSource, "ip");
  assert.equal("latitude" in first, false);
  assert.equal("longitude" in first, false);
  assert.equal(second.source, "cache");
  assert.equal(requestCount, 2);

  const stored = await readFile(path.join(directory, "local-weather-cache.json"), "utf8");
  assert.equal(stored.includes("30.27"), true);
  assert.equal(stored.includes("weather-room"), false);
});

test("weather service prefers Windows system coordinates over IP lookup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-weather-system-"));
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    return new Response(
      JSON.stringify({
        current: { time: "2026-08-15T14:00", is_day: 1, weather_code: 1 },
        daily: { sunrise: ["2026-08-15T05:56"], sunset: ["2026-08-15T18:51"] },
      }),
      { status: 200 },
    );
  };

  const snapshot = await new LocalWeatherService(directory, { fetcher }).getSnapshot({
    locationMode: "auto",
    systemPosition: { latitude: 22.5431, longitude: 114.0579, accuracyMeters: 30 },
  });

  assert.equal(snapshot.locationSource, "system");
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0]?.includes("latitude=22.5431"), true);
  assert.equal(
    requestedUrls.some((url) => url.includes("ipwho") || url.includes("ipapi")),
    false,
  );
});

test("weather service keeps stale local weather when the network fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-weather-stale-"));
  let shouldFail = false;
  const fetcher: typeof fetch = async (input) => {
    if (shouldFail) throw new Error("offline");
    const url = String(input);
    return new Response(
      JSON.stringify(
        url.includes("geocoding")
          ? { results: [{ name: "北京", latitude: 39.9, longitude: 116.4 }] }
          : {
              current: { time: "2026-08-14T12:00", is_day: 1, weather_code: 61 },
              daily: { sunrise: ["2026-08-14T05:22"], sunset: ["2026-08-14T19:12"] },
            },
      ),
      { status: 200 },
    );
  };
  const service = new LocalWeatherService(directory, { fetcher });
  const first = await service.getSnapshot({ locationMode: "manual", manualCity: "北京" });
  shouldFail = true;
  const fallback = await service.getSnapshot({
    locationMode: "manual",
    manualCity: "北京",
    forceRefresh: true,
  });

  assert.equal(first.scene, "light_rain");
  assert.equal(fallback.scene, "light_rain");
  assert.equal(fallback.source, "cache");
});

test("weather fallback still reports an automatically resolved city", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-weather-city-fallback-"));
  const fetcher: typeof fetch = async (input) => {
    if (String(input).includes("ipwho")) {
      return new Response(
        JSON.stringify({ success: true, city: "杭州", latitude: 30.27, longitude: 120.15 }),
        { status: 200 },
      );
    }
    throw new Error("forecast unavailable");
  };
  const snapshot = await new LocalWeatherService(directory, { fetcher }).getSnapshot({
    locationMode: "auto",
  });

  assert.equal(snapshot.source, "fallback");
  assert.equal(snapshot.city, "杭州");
});

test("weather visual theme changes the whole room without changing layout", () => {
  assert.equal(
    resolveWeatherVisualTheme({
      scene: "thunderstorm",
      phase: "day",
      fetchedAt: "",
      expiresAt: "",
      source: "live",
    }).roomTone,
    "storm",
  );
  assert.equal(
    resolveWeatherVisualTheme({
      scene: "clear",
      phase: "night",
      fetchedAt: "",
      expiresAt: "",
      source: "live",
    }).roomTone,
    "night",
  );
});
