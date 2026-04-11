import type { AppSettings } from "@private-voice/shared";

import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const ProfileSettingsCard = ({
  settings,
  avatarDataUrl,
  onChange,
  onPickAvatar,
  onClearAvatar,
}: {
  settings: AppSettings;
  avatarDataUrl?: string;
  onChange: (patch: Partial<AppSettings>) => void;
  onPickAvatar: () => void;
  onClearAvatar: () => void;
}) => (
  <SettingsSection title="基础资料" description="房间里别人看到的就是你的昵称和头像。">
    <div className="space-y-3">
      <SettingsItemRow label="头像" description="支持本地图片，只保存在这台设备里。">
        <AvatarPlaceholder name={settings.nickname || "上号"} src={avatarDataUrl} size="lg" />
        <Button variant="secondary" onClick={onPickAvatar}>
          选择头像
        </Button>
        <Button variant="ghost" onClick={onClearAvatar} disabled={!settings.avatarPath}>
          重置
        </Button>
      </SettingsItemRow>
      <SettingsItemRow label="昵称" description="会显示在成员位里。">
        <Input
          value={settings.nickname}
          placeholder="输入你的昵称"
          onChange={(event) => onChange({ nickname: event.target.value })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="默认房间名" description="你开房时默认使用。">
        <Input
          value={settings.roomName}
          onChange={(event) => onChange({ roomName: event.target.value })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
