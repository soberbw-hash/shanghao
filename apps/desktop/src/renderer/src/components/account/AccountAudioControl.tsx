import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, MicOff, Volume2 } from "lucide-react";

import { MicPermissionState } from "@private-voice/shared";

import { useAudioStore } from "../../store/audioStore";
import { useSettingsStore } from "../../store/settingsStore";

export const AccountAudioControl = () => {
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const permissionState = useAudioStore((state) => state.permissionState);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen]);

  if (!settings) return null;

  const hasInput = settings.preferredInputDeviceId
    ? inputDevices.some((device) => device.id === settings.preferredInputDeviceId)
    : inputDevices.length > 0;
  const hasOutput = outputDevices.length > 0;
  const audioReady = permissionState !== MicPermissionState.Denied && hasInput && hasOutput;

  return (
    <div ref={controlRef} className="account-audio-control">
      <button
        type="button"
        className="account-audio-status"
        aria-haspopup="dialog"
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        {audioReady ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
        <span>{audioReady ? "声音正常" : "检查声音设备"}</span>
        <ChevronDown className={isMenuOpen ? "is-open" : ""} aria-hidden="true" />
      </button>

      {isMenuOpen ? (
        <div className="account-audio-menu" role="dialog" aria-label="登录后使用的声音设备">
          <div>
            <strong>声音设备</strong>
            <span>登录后会直接使用这里的选择进入频道</span>
          </div>
          <label>
            <Mic aria-hidden="true" />
            <select
              value={settings.preferredInputDeviceId || ""}
              aria-label="麦克风设备"
              onChange={(event) =>
                void saveSettings({ preferredInputDeviceId: event.target.value || undefined })
              }
            >
              <option value="">系统默认麦克风</option>
              {inputDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label || "未命名麦克风"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Volume2 aria-hidden="true" />
            <select
              value={settings.preferredOutputDeviceId || ""}
              aria-label="扬声器设备"
              onChange={(event) =>
                void saveSettings({ preferredOutputDeviceId: event.target.value || undefined })
              }
            >
              <option value="">系统默认扬声器</option>
              {outputDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label || "未命名扬声器"}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
};
