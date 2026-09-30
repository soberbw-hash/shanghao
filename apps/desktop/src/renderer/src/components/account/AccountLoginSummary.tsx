import { ACCOUNT_AVATAR_PRESETS } from "../../features/account/accountAvatarPresets";
import { useSettingsStore } from "../../store/settingsStore";

interface AccountLoginSummaryProps {
  identifier: string;
  isRemembered: boolean;
}

export const AccountLoginSummary = ({ identifier, isRemembered }: AccountLoginSummaryProps) => {
  const hasSettings = useSettingsStore((state) => Boolean(state.settings));
  const accountAvatarPresetId = useSettingsStore((state) => state.settings?.accountAvatarPresetId);
  const nickname = useSettingsStore((state) => state.settings?.nickname);
  if (!hasSettings || !isRemembered) return null;

  const avatarPreset = ACCOUNT_AVATAR_PRESETS.find((preset) => preset.id === accountAvatarPresetId);
  const displayName = nickname?.trim() || identifier.trim() || "已记住的账号";

  return (
    <div className="account-login-summary">
      <div className="account-remembered-identity" aria-label="已记住的账号">
        <span className="account-remembered-avatar">
          {avatarPreset ? (
            <img src={avatarPreset.source} alt="" />
          ) : (
            displayName.slice(0, 1).toUpperCase()
          )}
        </span>
        <span className="account-remembered-copy">
          <strong>{displayName}</strong>
          <small>@{identifier.trim()}</small>
        </span>
        <span className="account-remembered-badge">已记住</span>
      </div>
    </div>
  );
};
