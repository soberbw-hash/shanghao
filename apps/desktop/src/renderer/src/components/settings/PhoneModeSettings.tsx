import { useSettingsStore } from "../../store/settingsStore";
import { useAppStore } from "../../store/appStore";
import { desktopApi } from "../../utils/desktopApi";
import { SettingsItemRow } from "./SettingsItemRow";
import { ShortcutInput } from "../base/ShortcutInput";

export function PhoneModeSettings() {
  const settings = useSettingsStore((state) => state.settings);
  const shortcut = settings?.phoneModeShortcut ?? "";
  const trigger = settings?.phoneModeTrigger ?? "hold";
  const configure = async (nextKey: string, nextTrigger: "hold" | "toggle") => {
    try {
      await desktopApi.phoneMode.configure(nextKey, nextTrigger);
      await useSettingsStore
        .getState()
        .saveSettings({ phoneModeShortcut: nextKey, phoneModeTrigger: nextTrigger });
    } catch (error) {
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "电话模式快捷键未更改",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <div className="phone-mode-settings">
      <SettingsItemRow
        label="电话模式"
        description="静音电脑全部音频设备，结束后恢复。独占音频可能绕过软件静音。"
      >
        <div className="phone-mode-settings-controls flex w-full flex-wrap items-center justify-end gap-3">
          <div className="phone-mode-shortcut-control flex min-w-[250px] flex-1 items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-[#667085]">快捷键</span>
            <div className="min-w-0 flex-1">
              <ShortcutInput
                value={shortcut}
                onChange={(value) => void configure(value, trigger)}
                defaultValue=""
                compact
                physicalKeys
              />
            </div>
          </div>
          <label className="phone-mode-trigger-control flex shrink-0 items-center gap-2">
            <span className="text-xs font-medium text-[#667085]">触发方式</span>
            <select
              aria-label="电话模式触发方式"
              className="phone-mode-trigger-select settings-inline-select"
              title="选择按住快捷键或按一次切换"
              value={trigger}
              onChange={(event) =>
                void configure(shortcut, event.target.value as "hold" | "toggle")
              }
            >
              <option value="hold">按住快捷键</option>
              <option value="toggle">按一次切换</option>
            </select>
          </label>
        </div>
      </SettingsItemRow>
    </div>
  );
}
