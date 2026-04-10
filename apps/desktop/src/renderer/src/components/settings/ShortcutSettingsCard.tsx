import type { AppSettings } from "@private-voice/shared";

import { ShortcutInput } from "../base/ShortcutInput";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const ShortcutSettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="Shortcuts" description="Keep the important controls reachable while you play.">
    <div className="space-y-3">
      <SettingsItemRow label="Global mute shortcut">
        <ShortcutInput
          value={settings.globalMuteShortcut}
          onChange={(globalMuteShortcut) => onChange({ globalMuteShortcut })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="Push-to-talk shortcut">
        <ShortcutInput
          value={settings.pushToTalkShortcut}
          onChange={(pushToTalkShortcut) => onChange({ pushToTalkShortcut })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="Enable push-to-talk">
        <Switch
          isChecked={settings.isPushToTalkEnabled}
          onChange={(isPushToTalkEnabled) => onChange({ isPushToTalkEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
