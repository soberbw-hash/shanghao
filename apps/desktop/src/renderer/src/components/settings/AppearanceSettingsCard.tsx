import type { AppSettings } from "@private-voice/shared";

import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const AppearanceSettingsCard = ({
  settings,
  onChange,
  section = "all",
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  section?: "all" | "floating" | "notifications";
}) => (
  <SettingsSection
    title={section === "floating" ? "悬浮小窗" : section === "notifications" ? "通知" : "悬浮小窗与通知"}
    description={section === "floating" ? "开黑时用小动物呼吸条看谁在说话。" : "只保留日常会用到的提醒。"}
  >
    <div className="space-y-3">
      {section !== "notifications" ? (
        <SettingsItemRow label="进入后显示悬浮小窗">
          <Switch
            isChecked={settings.showFloatingBarOnJoin}
            onChange={(showFloatingBarOnJoin) => onChange({ showFloatingBarOnJoin })}
          />
        </SettingsItemRow>
      ) : null}
      {section !== "floating" ? (
        <>
          <SettingsItemRow label="关闭时留在后台">
            <Switch
              isChecked={settings.minimizeToTray}
              onChange={(minimizeToTray) => onChange({ minimizeToTray })}
            />
          </SettingsItemRow>
          <SettingsItemRow label="启动时检查更新">
            <Switch
              isChecked={settings.isBackgroundUpdateCheckEnabled}
              onChange={(isBackgroundUpdateCheckEnabled) =>
                onChange({ isBackgroundUpdateCheckEnabled })
              }
            />
          </SettingsItemRow>
          <SettingsItemRow label="轻提示音">
            <Switch
              isChecked={settings.isUiSoundEnabled}
              onChange={(isUiSoundEnabled) => onChange({ isUiSoundEnabled })}
            />
          </SettingsItemRow>
        </>
      ) : null}
    </div>
  </SettingsSection>
);
