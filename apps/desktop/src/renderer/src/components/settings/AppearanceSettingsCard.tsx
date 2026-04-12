import type { AppSettings } from "@private-voice/shared";

import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const AppearanceSettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="体验" description="只保留你真正会改的桌面体验项。">
    <div className="space-y-3">
      <SettingsItemRow label="关闭时最小化到托盘">
        <Switch
          isChecked={settings.minimizeToTray}
          onChange={(minimizeToTray) => onChange({ minimizeToTray })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="减少动态效果">
        <Switch
          isChecked={settings.reduceMotion}
          onChange={(reduceMotion) => onChange({ reduceMotion })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="后台检查更新">
        <Switch
          isChecked={settings.isBackgroundUpdateCheckEnabled}
          onChange={(isBackgroundUpdateCheckEnabled) =>
            onChange({ isBackgroundUpdateCheckEnabled })
          }
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
