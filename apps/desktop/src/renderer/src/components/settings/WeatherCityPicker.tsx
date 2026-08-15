import { useMemo, useRef, useState } from "react";
import { ChevronRight, LocateFixed, MapPin, Search, X } from "lucide-react";

import {
  CHINA_CITY_NAMES,
  CHINA_CITY_REGION_GROUPS,
  CHINA_POPULAR_CITY_NAMES,
} from "../../features/weather/chinaCities";

type RegionId = "popular" | (typeof CHINA_CITY_REGION_GROUPS)[number]["id"];

export const WeatherCityPicker = ({
  selectedCity,
  detectedCity,
  isLoading,
  onSelect,
}: {
  selectedCity?: string;
  detectedCity?: string;
  isLoading: boolean;
  onSelect: (city?: string) => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeRegion, setActiveRegion] = useState<RegionId>("popular");
  const normalizedQuery = query.trim();
  const activeGroup = CHINA_CITY_REGION_GROUPS.find((group) => group.id === activeRegion);
  const displayedCities = useMemo(() => {
    if (normalizedQuery) {
      return CHINA_CITY_NAMES.filter((city) => city.includes(normalizedQuery));
    }
    if (activeRegion === "popular") return CHINA_POPULAR_CITY_NAMES;
    return activeGroup?.cities ?? [];
  }, [activeGroup?.cities, activeRegion, normalizedQuery]);
  const currentLabel = selectedCity || detectedCity || (isLoading ? "正在自动定位…" : "自动定位");

  const openPicker = () => {
    setQuery("");
    setActiveRegion("popular");
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const closePicker = () => dialogRef.current?.close();

  const selectCity = (city?: string) => {
    onSelect(city);
    closePicker();
  };

  return (
    <>
      <button
        type="button"
        className="weather-location-trigger"
        aria-haspopup="dialog"
        onClick={openPicker}
      >
        <MapPin size={17} aria-hidden="true" />
        <span className="weather-location-trigger-copy">
          <strong>{currentLabel}</strong>
          <span>{selectedCity ? "手动选择" : "自动定位"}</span>
        </span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>

      <dialog
        ref={dialogRef}
        className="weather-city-dialog"
        aria-labelledby="weather-city-dialog-title"
        aria-describedby="weather-city-dialog-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) closePicker();
        }}
        onClose={() => setQuery("")}
      >
        <div className="weather-city-dialog-shell">
          <header className="weather-city-dialog-header">
            <div>
              <h2 id="weather-city-dialog-title">选择天气位置</h2>
              <p id="weather-city-dialog-description">搜索全国城市，也可以直接输入区县或地点。</p>
            </div>
            <button
              type="button"
              className="weather-city-dialog-close"
              aria-label="关闭位置选择"
              onClick={closePicker}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="weather-city-dialog-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              aria-label="搜索城市或输入地点"
              placeholder="搜索城市，或输入区县、地点"
              autoComplete="off"
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && normalizedQuery) {
                  event.preventDefault();
                  selectCity(normalizedQuery.slice(0, 80));
                }
              }}
            />
          </div>

          <div className="weather-city-dialog-content">
            <nav className="weather-city-region-nav" aria-label="城市地区">
              <button
                type="button"
                data-active={activeRegion === "popular"}
                aria-current={activeRegion === "popular" ? "page" : undefined}
                onClick={() => {
                  setQuery("");
                  setActiveRegion("popular");
                }}
              >
                热门城市
              </button>
              {CHINA_CITY_REGION_GROUPS.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  data-active={activeRegion === group.id}
                  aria-current={activeRegion === group.id ? "page" : undefined}
                  onClick={() => {
                    setQuery("");
                    setActiveRegion(group.id);
                  }}
                >
                  {group.label}
                </button>
              ))}
            </nav>

            <section className="weather-city-dialog-results" aria-live="polite">
              <div className="weather-city-results-heading">
                <h3>
                  {normalizedQuery
                    ? `搜索“${normalizedQuery}”`
                    : activeRegion === "popular"
                      ? "热门城市"
                      : activeGroup?.label}
                </h3>
                <span>{displayedCities.length} 个结果</span>
              </div>

              {displayedCities.length ? (
                <div className="weather-city-grid">
                  {displayedCities.map((city) => (
                    <button
                      key={city}
                      type="button"
                      data-selected={selectedCity === city}
                      onClick={() => selectCity(city)}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="weather-city-empty">
                  <MapPin size={22} aria-hidden="true" />
                  <strong>城市列表中没有完全对应的名称</strong>
                  <span>仍然可以把“{normalizedQuery}”作为天气位置使用。</span>
                </div>
              )}

              {normalizedQuery ? (
                <div className="weather-city-custom">
                  <div>
                    <strong>没有合适的结果？</strong>
                    <span>可直接使用你输入的区县或地点。</span>
                  </div>
                  <button type="button" onClick={() => selectCity(normalizedQuery.slice(0, 80))}>
                    使用“{normalizedQuery}”
                  </button>
                </div>
              ) : null}
            </section>
          </div>

          <footer className="weather-city-dialog-footer">
            <div>
              <LocateFixed size={17} aria-hidden="true" />
              <span>
                {detectedCity ? `当前定位：${detectedCity}` : "优先使用 Windows 系统定位"}
              </span>
            </div>
            <button type="button" onClick={() => selectCity(undefined)}>
              恢复自动定位
            </button>
          </footer>
        </div>
      </dialog>
    </>
  );
};
