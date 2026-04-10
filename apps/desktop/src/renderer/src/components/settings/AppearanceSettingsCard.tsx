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
  <SettingsSection title="Appearance & behavior" description="Keep movement restrained and tray behavior predictable.">
    <div className="space-y-3">
      <SettingsItemRow label="Minimize to tray">
        <Switch
          isChecked={settings.minimizeToTray}
          onChange={(minimizeToTray) => onChange({ minimizeToTray })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="Reduce motion">
        <Switch
          isChecked={settings.reduceMotion}
          onChange={(reduceMotion) => onChange({ reduceMotion })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
