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
  <SettingsSection title="体验" description="托盘、动效和提示音都可以自己决定。">
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
      <SettingsItemRow label="开麦提示音">
        <Switch
          isChecked={settings.isMicOnSoundEnabled}
          onChange={(isMicOnSoundEnabled) => onChange({ isMicOnSoundEnabled })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="关麦提示音">
        <Switch
          isChecked={settings.isMicOffSoundEnabled}
          onChange={(isMicOffSoundEnabled) => onChange({ isMicOffSoundEnabled })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="成员进入提示音">
        <Switch
          isChecked={settings.isMemberJoinSoundEnabled}
          onChange={(isMemberJoinSoundEnabled) => onChange({ isMemberJoinSoundEnabled })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="成员退出提示音">
        <Switch
          isChecked={settings.isMemberLeaveSoundEnabled}
          onChange={(isMemberLeaveSoundEnabled) => onChange({ isMemberLeaveSoundEnabled })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="连接成功 / 失败提示音">
        <Switch
          isChecked={settings.isConnectionSoundEnabled}
          onChange={(isConnectionSoundEnabled) => onChange({ isConnectionSoundEnabled })}
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
