import { useRef, useState } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { ShortcutInput } from "../base/ShortcutInput";
import { SettingsItemRow } from "./SettingsItemRow";

export function AudioPresetShortcutSettings() {
  const shortcut = useSettingsStore((state) => state.settings?.audioDevicePresetShortcut ?? "");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const bind = async (key: string) => {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      const result = await useSettingsStore
        .getState()
        .saveSettings({ audioDevicePresetShortcut: key });
      if ((result.audioDevicePresetShortcut ?? "") !== key)
        setError("快捷键被占用或格式不支持，原设置保留。");
    } catch {
      setError("快捷键未保存，请稍后重试。");
    } finally {
      busy.current = false;
    }
  };
  return (
    <SettingsItemRow
      label="切换音频配置"
      description={error || "在已保存的两套麦克风与扬声器配置间切换。"}
    >
      <ShortcutInput
        compact
        alignDefaultSlot
        value={shortcut}
        onChange={(key) => void bind(key)}
        placeholder="可选，例如 Ctrl＋Shift＋F9"
      />
    </SettingsItemRow>
  );
}
