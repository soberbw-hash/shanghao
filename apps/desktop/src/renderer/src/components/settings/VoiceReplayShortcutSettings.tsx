import { useRef, useState } from "react";
import {
  readVoiceReplayShortcut,
  saveVoiceReplayShortcut,
} from "../../features/recording/voiceReplayShortcut";
import { ShortcutInput } from "../base/ShortcutInput";
import { SettingsItemRow } from "./SettingsItemRow";

export function VoiceReplayShortcutSettings() {
  const [shortcut, setShortcut] = useState(readVoiceReplayShortcut);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const bind = async (next: string) => {
    if (busy.current) return;
    busy.current = true;
    setError("");
    try {
      if (!(await window.desktopApi.voiceReplay?.shortcut(next))) {
        setError("快捷键被占用或格式不支持，原设置保留。");
        return;
      }
      setShortcut(next);
      if (!saveVoiceReplayShortcut(next)) setError("本次快捷键已生效，本机保存失败。");
    } catch {
      setError("快捷键未修改，请稍后重试。");
    } finally {
      busy.current = false;
    }
  };
  return (
    <SettingsItemRow
      label="保存刚才对话"
      description={error || "全员同意保留原声后，保存最近选定时长的声音。"}
    >
      <ShortcutInput
        compact
        value={shortcut}
        onChange={(next) => void bind(next)}
        defaultValue="Ctrl+Shift+F8"
      />
    </SettingsItemRow>
  );
}
