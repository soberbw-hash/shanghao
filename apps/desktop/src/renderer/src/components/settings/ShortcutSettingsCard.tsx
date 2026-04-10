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
  <SettingsSection title="快捷键" description="把常用操作留在手边，打游戏时也能快速控制。">
    <div className="space-y-3">
      <SettingsItemRow label="全局静音快捷键">
        <ShortcutInput
          value={settings.globalMuteShortcut}
          onChange={(globalMuteShortcut) => onChange({ globalMuteShortcut })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="按键说话快捷键">
        <ShortcutInput
          value={settings.pushToTalkShortcut}
          onChange={(pushToTalkShortcut) => onChange({ pushToTalkShortcut })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="启用按键说话">
        <Switch
          isChecked={settings.isPushToTalkEnabled}
          onChange={(isPushToTalkEnabled) => onChange({ isPushToTalkEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
