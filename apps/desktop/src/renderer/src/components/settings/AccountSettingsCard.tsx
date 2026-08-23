import { useEffect, useState } from "react";
import { Camera, LogOut, ShieldCheck, UserRound } from "lucide-react";

import { Button } from "../base/Button";
import { accountErrorMessage } from "../../features/account/accountMessages";
import { prepareAccountAvatar } from "../../features/account/prepareAccountAvatar";
import { useAccountStore } from "../../store/accountStore";
import { useAppStore } from "../../store/appStore";

export const AccountSettingsCard = () => {
  const snapshot = useAccountStore((state) => state.snapshot);
  const isBusy = useAccountStore((state) => state.isBusy);
  const updateProfile = useAccountStore((state) => state.updateProfile);
  const updateAvatar = useAccountStore((state) => state.updateAvatar);
  const logout = useAccountStore((state) => state.logout);
  const pushToast = useAppStore((state) => state.pushToast);
  const profile = snapshot.profile;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");

  useEffect(() => setDisplayName(profile?.displayName ?? ""), [profile?.displayName]);

  if (snapshot.status === "guest") {
    return (
      <section className="settings-section account-settings-card">
        <div className="account-settings-empty">
          <UserRound />
          <h2>当前为开发访客</h2>
          <p>访客身份只用于本地开发测试，不会同步资料，也不能进入正式服务器。</p>
          <Button variant="secondary" onClick={() => void logout()}>
            返回登录
          </Button>
        </div>
      </section>
    );
  }

  if (!profile) return null;

  const saveDisplayName = async () => {
    const next = displayName.trim();
    if (!next || next === profile.displayName) return;
    try {
      await updateProfile({ displayName: next });
      pushToast({ tone: "success", title: "显示名已更新" });
    } catch (error) {
      pushToast({ tone: "danger", title: "资料没有保存", description: accountErrorMessage(error) });
    }
  };

  const chooseAvatar = async () => {
    const picked = await window.desktopApi.profile.pickAvatar();
    if (!picked) return;
    try {
      await updateAvatar({ dataUrl: await prepareAccountAvatar(picked.avatarDataUrl) });
      pushToast({ tone: "success", title: "头像已更新" });
    } catch (error) {
      pushToast({ tone: "danger", title: "头像没有保存", description: accountErrorMessage(error) });
    }
  };

  return (
    <div className="space-y-4">
      <section className="settings-section account-settings-card">
        <header className="account-settings-profile">
          <button
            type="button"
            className="account-settings-avatar"
            onClick={() => void chooseAvatar()}
            disabled={isBusy}
          >
            {profile.avatarUrl ? <img src={profile.avatarUrl} alt="账号头像" /> : <UserRound />}
            <span>
              <Camera />
            </span>
          </button>
          <div>
            <h2>{profile.displayName}</h2>
            <p>@{profile.username}</p>
          </div>
          <span className="account-verified-badge">
            <ShieldCheck /> 已登录
          </span>
        </header>

        {snapshot.developmentConnection ? (
          <div className="account-development-connection" role="status">
            当前使用开发测试连接（房间未启用 TLS）；密码与 Session 刷新仍只访问 Supabase HTTPS。
          </div>
        ) : null}

        <div className="account-settings-fields">
          <label>
            <span>显示名</span>
            <div>
              <input
                value={displayName}
                maxLength={32}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <Button
                disabled={
                  isBusy || !displayName.trim() || displayName.trim() === profile.displayName
                }
                onClick={() => void saveDisplayName()}
              >
                保存
              </Button>
            </div>
          </label>
          <label>
            <span>用户名</span>
            <input value={profile.username} readOnly aria-readonly="true" />
            <small>唯一登录名，当前版本不可修改。</small>
          </label>
          <label>
            <span>邮箱</span>
            <input value={profile.email ?? ""} readOnly aria-readonly="true" />
          </label>
          <label>
            <span>用户 ID</span>
            <input value={profile.userId} readOnly aria-readonly="true" />
            <small>房间身份由服务器验证，其他客户端无法伪造。</small>
          </label>
        </div>
      </section>

      <section className="settings-section account-settings-danger">
        <div>
          <strong>退出账号</strong>
          <p>本地录音、模型和设置不会被删除。</p>
        </div>
        <Button variant="danger" disabled={isBusy} onClick={() => void logout()}>
          <LogOut /> 退出登录
        </Button>
      </section>
    </div>
  );
};
