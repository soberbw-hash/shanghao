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
  <SettingsSection title="Profile" description="Light identity only. No accounts, no social graph.">
    <div className="space-y-3">
      <SettingsItemRow label="Nickname" description="Shown inside the room and member cards.">
        <Input value={settings.nickname} onChange={(event) => onChange({ nickname: event.target.value })} />
      </SettingsItemRow>
      <SettingsItemRow label="Default room name" description="Used when you host a new session.">
        <Input value={settings.roomName} onChange={(event) => onChange({ roomName: event.target.value })} />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
