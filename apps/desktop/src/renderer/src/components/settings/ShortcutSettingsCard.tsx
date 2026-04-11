import type { AppSettings } from "@private-voice/shared";

import { ShortcutInput } from "../base/ShortcutInput";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const ShortcutSettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="快捷键" description="只保留常用的两个。">
    <div className="space-y-3">
      <SettingsItemRow label="全局静音快捷键" description="默认关闭，避免启动时被危险快捷键卡住。">
        <ShortcutInput
          value={settings.globalMuteShortcut}
          onChange={(globalMuteShortcut) => onChange({ globalMuteShortcut })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="PTT 快捷键">
        <ShortcutInput
          value={settings.pushToTalkShortcut}
          onChange={(pushToTalkShortcut) => onChange({ pushToTalkShortcut })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
