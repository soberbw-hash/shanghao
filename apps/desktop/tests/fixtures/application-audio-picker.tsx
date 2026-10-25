import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationAudioPicker } from "../../src/renderer/src/components/audio/ApplicationAudioPicker";
import "../../src/renderer/src/styles/index.css";

// Disposable UI data, not a recording, remote image or real capture source.
const icon = (letter: string, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="9" fill="${color}"/><text x="20" y="28" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#fff">${letter}</text></svg>`)}`;
const sources = [
  {
    id: "music",
    name: "我喜欢的音乐 · 网易云音乐",
    processName: "cloudmusic.exe",
    appIconDataUrl: icon("M", "#ad4e5c"),
  },
  {
    id: "spotify",
    name: "正在播放的歌曲与很长的一段标题，检查实际中文是否清楚且不会撑破布局",
    processName: "spotify.exe",
    appIconDataUrl: icon("S", "#39668c"),
  },
  { id: "fallback", name: "未提供图标的播放器", processName: "AppleMusic.exe" },
];
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [displaySources, setDisplaySources] = useState(sources);
  const [open, setOpen] = useState(params.has("open")),
    [id, setId] = useState(params.get("selected") ?? "");
  const [mode, setMode] = useState(params.get("mode") ?? "ready"),
    [sharing, setSharing] = useState<string>();
  const evidence = { stopped: 0, started: 0, refreshed: 0, closed: 0 };
  const [events] = useState(evidence);
  Object.assign(window, { pickerEvidence: events, pickerMode: setMode });
  const nativeIcons = params.has("native");
  useEffect(() => {
    if (!nativeIcons) return;
    let active = true;
    void fetch(
      "/@fs/C:/Users/sober/Documents/Codex/2026-10-17/files-mentioned-by-the-user-codex/work/shanghao/artifacts/application-audio-native-icons.json",
    )
      .then((response) => response.json())
      .then((value) => {
        if (active) setDisplaySources(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [nativeIcons]);
  return (
    <>
      <div
        style={{ position: "fixed", inset: "0 0 0 60%", zIndex: 2147483647, background: "#d4e4f4" }}
      >
        模拟聊天面板遮挡
      </div>
      <main style={{ transform: "translateZ(0)", overflow: "hidden", height: 120, margin: 40 }}>
        <button id="open-picker" onClick={() => setOpen(true)}>
          放歌
        </button>
        <output>取消次数：{events.stopped}</output>
        <ApplicationAudioPicker
          open={open}
          sources={mode === "empty" ? [] : displaySources}
          selectedId={id}
          loading={mode === "loading"}
          busy={mode === "busy"}
          error={mode === "error" ? "列表读取失败，请刷新重试。" : ""}
          sharingName={sharing}
          gain={0.72}
          onSelect={setId}
          onRefresh={() => {
            events.refreshed++;
            setMode("ready");
          }}
          onStart={() => {
            events.started++;
            setSharing(sources.find((source) => source.id === id)?.name);
          }}
          onStop={() => {
            events.stopped++;
            setSharing(undefined);
            setMode("ready");
          }}
          onClose={() => {
            events.closed++;
            setOpen(false);
          }}
          returnFocus={() => document.getElementById("open-picker")?.focus()}
          onGain={() => undefined}
        />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
