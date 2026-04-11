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
  <SettingsSection title="体验" description="把托盘和动效调到你习惯的状态。">
    <div className="space-y-3">
      <SettingsItemRow label="最小化到托盘">
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
    </div>
  </SettingsSection>
);
