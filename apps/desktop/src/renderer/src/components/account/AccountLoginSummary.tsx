import type { AccountProfile } from "@private-voice/shared";
import { accountProfileAvatarSource } from "../../features/account/accountAvatarPresets";
import { AccountAvatar } from "./AccountAvatar";

interface AccountLoginSummaryProps {
  identifier: string;
  isRemembered: boolean;
  profile?: AccountProfile;
}

export const AccountLoginSummary = ({
  identifier,
  isRemembered,
  profile,
}: AccountLoginSummaryProps) => {
  if (!isRemembered) return null;
  const displayName = profile?.displayName ?? "已记住的账号";

  return (
    <div className="account-login-summary">
      <div className="account-remembered-identity" aria-label="已记住的账号">
        <AccountAvatar
          className="account-remembered-avatar"
          name={displayName}
          src={profile?.avatarUrl}
          fallbackSrc={accountProfileAvatarSource(profile)}
        />
        <span className="account-remembered-copy">
          <strong>{displayName}</strong>
          <small>{profile?.username ? `@${profile.username}` : identifier.trim()}</small>
        </span>
        <span className="account-remembered-badge">已记住</span>
      </div>
    </div>
  );
};
