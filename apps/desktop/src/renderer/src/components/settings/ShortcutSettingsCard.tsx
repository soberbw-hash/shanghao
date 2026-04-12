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
}) => {
  const hasConflict =
    Boolean(settings.globalMuteShortcut) &&
    Boolean(settings.pushToTalkShortcut) &&
    settings.globalMuteShortcut === settings.pushToTalkShortcut;

  return (
    <SettingsSection title="快捷键" description="只保留常用的两个。">
      <div className="space-y-3">
        <SettingsItemRow
          label="全局静音快捷键"
          description="默认关闭，避免启动时被危险快捷键卡住。"
        >
          <ShortcutInput
            value={settings.globalMuteShortcut}
            onChange={(globalMuteShortcut) => onChange({ globalMuteShortcut })}
            placeholder="未启用"
          />
        </SettingsItemRow>
        <SettingsItemRow label="PTT 按键" description="按住说话，松开闭麦。">
          <ShortcutInput
            value={settings.pushToTalkShortcut}
            onChange={(pushToTalkShortcut) => onChange({ pushToTalkShortcut })}
            defaultValue="Space"
            conflictMessage={hasConflict ? "PTT 按键不能和全局静音快捷键重复。" : undefined}
          />
        </SettingsItemRow>
      </div>
    </SettingsSection>
  );
};
