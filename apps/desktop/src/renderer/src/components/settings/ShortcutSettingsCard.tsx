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
  return (
    <SettingsSection title="快捷键">
      <div className="space-y-3">
        <SettingsItemRow label="按键说话" description="上号窗口聚焦时按住说话，松开闭麦。">
          <ShortcutInput
            value={settings.pushToTalkShortcut}
            onChange={(pushToTalkShortcut) => onChange({ pushToTalkShortcut })}
            defaultValue="Space"
          />
        </SettingsItemRow>
        <SettingsItemRow
          label="标记精彩时刻"
          description="录音中按一下，在录音旁生成可直接阅读的精彩时刻文本。"
        >
          <ShortcutInput
            value={settings.recordingMarkerShortcut}
            onChange={(recordingMarkerShortcut) => onChange({ recordingMarkerShortcut })}
            defaultValue="F8"
          />
        </SettingsItemRow>
      </div>
    </SettingsSection>
  );
};
