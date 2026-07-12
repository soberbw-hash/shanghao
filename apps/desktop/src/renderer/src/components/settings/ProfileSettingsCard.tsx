import type { AppSettings } from "@private-voice/shared";

import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Input } from "../base/Input";
import { AvatarPicker } from "../profile/AvatarPicker";
import { getAvatarSrc } from "../../utils/profile";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const ProfileSettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="资料" description="频道里别人看到的昵称和头像。">
    <div className="space-y-3">
      <SettingsItemRow label="头像" description="使用轻量内置头像，连接更稳定。">
        <div className="flex min-w-[420px] items-center gap-4">
          <AvatarPlaceholder
            name={settings.nickname || "上号"}
            src={getAvatarSrc(settings.avatarId)}
            size="lg"
          />
          <div className="flex-1">
            <AvatarPicker
              value={settings.avatarId}
              onChange={(avatarId) => onChange({ avatarId })}
            />
          </div>
        </div>
      </SettingsItemRow>
      <SettingsItemRow label="昵称" description="会显示在队伍里。">
        <div className="flex min-w-[420px]">
          <Input
            value={settings.nickname}
            maxLength={24}
            placeholder="输入你的昵称"
            onChange={(event) => onChange({ nickname: event.target.value })}
          />
        </div>
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
