import type { AppSettings } from "@private-voice/shared";

import { Input } from "../base/Input";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const ProfileSettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="基础信息" description="只保留房间里需要看到的昵称和房间名。">
    <div className="space-y-3">
      <SettingsItemRow label="昵称" description="会显示在房间和成员卡片里。">
        <Input value={settings.nickname} onChange={(event) => onChange({ nickname: event.target.value })} />
      </SettingsItemRow>
      <SettingsItemRow label="默认房间名" description="每次你开启房间时会优先使用这个名字。">
        <Input value={settings.roomName} onChange={(event) => onChange({ roomName: event.target.value })} />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
