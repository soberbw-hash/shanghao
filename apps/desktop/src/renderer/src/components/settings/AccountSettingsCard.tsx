import { useEffect, useRef, useState } from "react";
import { Camera, Check, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { accountAvatarPresetForIdentity } from "@private-voice/shared";

import { Button } from "../base/Button";
import { accountErrorMessage } from "../../features/account/accountMessages";
import { ACCOUNT_AVATAR_PRESETS } from "../../features/account/accountAvatarPresets";
import { prepareAccountAvatar } from "../../features/account/prepareAccountAvatar";
import { useAccountStore } from "../../store/accountStore";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { AccountRoomsPanel } from "./AccountRoomsPanel";

export const AccountSettingsCard = () => {
  const snapshot = useAccountStore((state) => state.snapshot);
  const isBusy = useAccountStore((state) => state.isBusy);
  const updateProfile = useAccountStore((state) => state.updateProfile);
  const updateAvatar = useAccountStore((state) => state.updateAvatar);
  const logout = useAccountStore((state) => state.logout);
  const pushToast = useAppStore((state) => state.pushToast);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const profile = snapshot.profile;
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState<{ userId: string; id: string }>();
  const [isAvatarSaving, setIsAvatarSaving] = useState(false);
  const avatarSaveLock = useRef(false);

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
      pushToast({ tone: "success", title: "昵称已更新" });
    } catch (error) {
      pushToast({ tone: "danger", title: "资料没有保存", description: accountErrorMessage(error) });
    }
  };

  const savedAvatarId =
    profile.accountAvatarPresetId ??
    (profile.avatarUrl ? undefined : accountAvatarPresetForIdentity(profile.userId));
  const draftId = avatarDraft?.userId === profile.userId ? avatarDraft.id : savedAvatarId;
  const selectedAvatar = ACCOUNT_AVATAR_PRESETS.find((preset) => preset.id === draftId);
  const avatarChanged = Boolean(selectedAvatar && selectedAvatar.id !== savedAvatarId);
  const busy = isBusy || isAvatarSaving;

  const saveAvatar = async () => {
    if (!avatarChanged || !selectedAvatar || busy || avatarSaveLock.current) return;
    avatarSaveLock.current = true;
    setIsAvatarSaving(true);
    const presetId = selectedAvatar.id;
    const userId = profile.userId;
    try {
      const preset = ACCOUNT_AVATAR_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) throw new Error("account_avatar_invalid");
      const dataUrl = await prepareAccountAvatar(preset.source);
      if (useAccountStore.getState().snapshot.profile?.userId !== userId) return;
      await updateAvatar({ dataUrl, accountAvatarPresetId: preset.id });
      if (useAccountStore.getState().snapshot.profile?.userId !== userId) return;
      let preferenceSaved = true;
      await saveSettings({ accountAvatarPresetId: presetId }).catch(() => {
        preferenceSaved = false;
      });
      setAvatarDraft(undefined);
      setIsAvatarPickerOpen(false);
      pushToast({
        tone: preferenceSaved ? "success" : "warning",
        title: "头像已同步",
        description: preferenceSaved
          ? "房间和悬浮窗会自动更新。"
          : "本地偏好未保存，账号头像不受影响。",
      });
    } catch (error) {
      pushToast({ tone: "danger", title: "头像没有保存", description: accountErrorMessage(error) });
    } finally {
      avatarSaveLock.current = false;
      setIsAvatarSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="settings-section account-settings-card">
        <header className="account-settings-profile">
          <button
            type="button"
            className="account-settings-avatar"
            onClick={() => setIsAvatarPickerOpen((open) => !open)}
            disabled={busy}
            aria-expanded={isAvatarPickerOpen}
            aria-label="更换头像"
          >
            {profile.avatarUrl || selectedAvatar ? (
              <img
                src={
                  avatarChanged
                    ? selectedAvatar?.source
                    : (profile.avatarUrl ?? selectedAvatar?.source)
                }
                alt="账号头像"
              />
            ) : (
              <UserRound />
            )}
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

        {isAvatarPickerOpen ? (
          <div>
            <div className="account-settings-avatar-picker" role="radiogroup" aria-label="选择头像">
              {ACCOUNT_AVATAR_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedAvatar?.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    title={preset.name}
                    className={isSelected ? "is-selected" : ""}
                    disabled={busy}
                    onClick={() => setAvatarDraft({ userId: profile.userId, id: preset.id })}
                  >
                    <img src={preset.source} alt={preset.name} />
                    {isSelected ? <Check aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500">选择后预览，保存后同步。</span>
              <Button
                variant="secondary"
                disabled={busy || !avatarChanged}
                onClick={() => void saveAvatar()}
              >
                {isAvatarSaving ? "保存中…" : "保存头像"}
              </Button>
            </div>
          </div>
        ) : null}

        {snapshot.developmentConnection ? (
          <div className="account-development-connection" role="status">
            当前使用开发测试连接（房间未启用 TLS）；密码与 Session 刷新仍只访问 Supabase HTTPS。
          </div>
        ) : null}

        <div className="account-settings-columns">
          <div className="account-settings-details">
            <div className="account-settings-fields">
              <label>
                <span>昵称</span>
                <input
                  value={displayName}
                  maxLength={32}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label>
                <span>账号</span>
                <input value={profile.username} readOnly aria-readonly="true" />
                <small>唯一账号名，当前版本不可修改。</small>
              </label>
              <label>
                <span>用户 ID</span>
                <input value={profile.userId} readOnly aria-readonly="true" />
                <small>房间身份由服务器验证，其他客户端无法伪造。</small>
              </label>
            </div>
            <div className="account-settings-save">
              <Button
                variant="secondary"
                disabled={busy || !displayName.trim() || displayName.trim() === profile.displayName}
                onClick={() => void saveDisplayName()}
              >
                {isBusy ? "保存中…" : "保存修改"}
              </Button>
            </div>
          </div>
          <AccountRoomsPanel userId={profile.userId} />
        </div>
      </section>

      <section className="settings-section account-settings-danger">
        <div>
          <strong>退出账号</strong>
          <p>本地录音、模型和设置不会被删除。</p>
        </div>
        <Button variant="danger" disabled={busy} onClick={() => void logout()}>
          <LogOut /> 退出登录
        </Button>
      </section>
    </div>
  );
};
