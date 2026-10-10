import type { AppSettings } from "@private-voice/shared";
import { SettingsItemRow } from "./SettingsItemRow";
import { playUiSound, setUiSoundVolume } from "../../features/audio/uiSound";

export const InterfaceSoundVolumeRow = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsItemRow
    label="界面音效音量"
    description="按钮、开关麦和成员进出提示；语音包音量单独设置。"
  >
    <div className="flex w-56 max-w-full items-center gap-3">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        aria-label="界面音效音量"
        data-ui-sound="handled"
        className="min-w-0 flex-1 accent-blue-500"
        value={settings.soundVolume}
        onChange={(event) => {
          const soundVolume = Number(event.target.value);
          setUiSoundVolume(soundVolume);
          onChange({ soundVolume });
        }}
        onPointerUp={() => playUiSound("button-click")}
        onKeyUp={(event) => {
          if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
          )
            playUiSound("button-click");
        }}
      />
      <output className="w-12 text-right text-sm tabular-nums text-slate-500">
        {Math.round(settings.soundVolume * 100)}%
      </output>
    </div>
  </SettingsItemRow>
);
