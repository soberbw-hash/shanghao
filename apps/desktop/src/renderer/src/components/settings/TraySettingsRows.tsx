import type { AppSettings } from "@private-voice/shared";
import { useAccountStore } from "../../store/accountStore";
import { SettingsItemRow } from "./SettingsItemRow";
import { Switch } from "../base/Switch";

export const TraySettingsRows = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) => {
  const signedIn = useAccountStore((state) => state.snapshot.status === "signed_in");
  const reason = !signedIn
    ? "登录后可开启"
    : !settings.isSystemNotificationEnabled
      ? "开启系统通知后可用"
      : "窗口不在前台时，提醒我的房间和收藏房间有人上线";
  return (
    <>
      <SettingsItemRow label="关闭窗口时留在后台">
        <Switch
          ariaLabel="关闭窗口时留在后台"
          isChecked={settings.minimizeToTray}
          onChange={(minimizeToTray) => onChange({ minimizeToTray })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="好友上线提醒" description={reason}>
        <Switch
          ariaLabel="好友上线提醒"
          isChecked={settings.isFriendOnlineNotificationEnabled}
          isDisabled={!signedIn || !settings.isSystemNotificationEnabled}
          onChange={(isFriendOnlineNotificationEnabled) =>
            onChange({ isFriendOnlineNotificationEnabled })
          }
        />
      </SettingsItemRow>
    </>
  );
};
