import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Smartphone, UserRound } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import type { AccountAvatarPresetId, AccountProfile } from "@private-voice/shared";

import {
  CLOUDBASE_USERNAME_MESSAGE,
  isValidCloudBaseUsername,
} from "../../../common/cloudbase-username";

import { Button } from "../components/base/Button";
import { BrandMark } from "../components/brand/BrandMark";
import { AccountAudioControl } from "../components/account/AccountAudioControl";
import { AccountLoginSummary } from "../components/account/AccountLoginSummary";
import { ACCOUNT_AVATAR_PRESETS } from "../features/account/accountAvatarPresets";
import { accountErrorMessage } from "../features/account/accountMessages";
import { prepareAccountAvatar } from "../features/account/prepareAccountAvatar";
import { playUiSound } from "../features/audio/uiSound";
import { motionCurve, motionDuration, motionSpring } from "../features/motion/motionSystem";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useAccountStore } from "../store/accountStore";
import { useSettingsStore } from "../store/settingsStore";
import { HomePage } from "./HomePage";

type AccountMode = "login" | "register";

const normalizePhoneInput = (input: string): string => {
  const digits = input.replace(/\D/g, "");
  // Let users paste either the usual 11-digit number or a +86-prefixed number,
  // while keeping the form value in the simple format they expect to type.
  const withoutCountryCode =
    digits.startsWith("86") && digits.length > 11 ? digits.slice(2) : digits;
  return withoutCountryCode.slice(0, 11);
};

const accountModeOrder: Record<AccountMode, number> = {
  login: 0,
  register: 1,
};

export const AccountPage = () => {
  const snapshot = useAccountStore((state) => state.snapshot);
  const isBusy = useAccountStore((state) => state.isBusy);
  const errorCode = useAccountStore((state) => state.errorCode);
  const login = useAccountStore((state) => state.login);
  const register = useAccountStore((state) => state.register);
  const requestVerificationCode = useAccountStore((state) => state.requestVerificationCode);
  const requestPasswordReset = useAccountStore((state) => state.requestPasswordReset);
  const continueAsGuest = useAccountStore((state) => state.continueAsGuest);
  const clearError = useAccountStore((state) => state.clearError);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const reduceMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<AccountMode>("login");
  const [modeDirection, setModeDirection] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationCountdown, setVerificationCountdown] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [rememberedIdentifier, setRememberedIdentifier] = useState("");
  const [rememberedProfile, setRememberedProfile] = useState<AccountProfile>();
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetNotice, setResetNotice] = useState<string>();
  const [resetSent, setResetSent] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetCountdown, setResetCountdown] = useState(0);
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState<
    AccountAvatarPresetId | undefined
  >();
  const [localError, setLocalError] = useState<string>();
  const accountServiceReady = snapshot.configured && snapshot.status !== "unavailable";

  useEffect(() => {
    let active = true;
    void window.desktopApi.account
      .getRememberedLogin()
      .then((remembered) => {
        if (!active || !remembered) return;
        setIdentifier((current) => current || remembered.identifier);
        setPassword((current) => current || remembered.password);
        setRememberedIdentifier(remembered.identifier);
        setRememberedProfile(remembered.profile);
        setRememberMe(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (resetCountdown <= 0) return;
    const timer = window.setTimeout(
      () => setResetCountdown((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [resetCountdown]);

  useEffect(() => {
    if (verificationCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setVerificationCountdown((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [verificationCountdown]);

  const effectiveError = localError ?? (errorCode ? accountErrorMessage(errorCode) : undefined);
  const title = isResetOpen ? "重置密码" : mode === "login" ? "欢迎回来" : "创建上号账号";
  const subtitle = isResetOpen
    ? "验证注册手机号或邮箱后，设置新的登录密码。"
    : mode === "login"
      ? undefined
      : "手机号验证后即可创建账号，昵称以后可以修改。";

  const canSubmit = useMemo(() => {
    if (isBusy || !accountServiceReady) return false;
    if (mode === "login") return Boolean(identifier.trim() && password);
    return Boolean(
      phone.trim() &&
      /^\d{6}$/.test(verificationCode.trim()) &&
      username.trim() &&
      selectedAvatarPresetId &&
      password &&
      confirmPassword,
    );
  }, [
    accountServiceReady,
    confirmPassword,
    identifier,
    isBusy,
    mode,
    password,
    phone,
    selectedAvatarPresetId,
    username,
    verificationCode,
  ]);

  const changeMode = (next: AccountMode) => {
    if (isBusy) return;
    setIsResetOpen(false);
    setResetCode("");
    setResetPassword("");
    setResetConfirmation("");
    if (next === mode) return;
    clearError();
    setLocalError(undefined);
    setModeDirection(accountModeOrder[next] >= accountModeOrder[mode] ? 1 : -1);
    setMode(next);
    playUiSound("settings-section");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isResetOpen) {
      if (resetSent) await completePasswordReset();
      else await submitPasswordReset();
      return;
    }
    setLocalError(undefined);
    try {
      if (mode === "login") {
        await login({ identifier: identifier.trim(), password, rememberMe });
        playUiSound("account-success");
        return;
      }
      // This comparison only provides immediate form feedback; credentials are validated by CloudBase.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (password !== confirmPassword) {
        setLocalError("两次输入的密码不一致，请重新确认。");
        playUiSound("process-error");
        return;
      }
      if (!isValidCloudBaseUsername(username)) {
        setLocalError(accountErrorMessage("account_username_invalid"));
        playUiSound("process-error");
        return;
      }
      const preset = ACCOUNT_AVATAR_PRESETS.find(
        (candidate) => candidate.id === selectedAvatarPresetId,
      );
      if (!preset) {
        setLocalError("请先选择一张账号头像。");
        playUiSound("process-error");
        return;
      }
      const avatarDataUrl = await prepareAccountAvatar(preset.source);
      await register({
        username: username.trim(),
        phone: phone.trim(),
        verificationCode: verificationCode.trim(),
        password,
        displayName: displayName.trim() || username.trim(),
        avatarDataUrl,
        accountAvatarPresetId: preset.id,
      });
      await saveSettings({ accountAvatarPresetId: preset.id });
      playUiSound("account-success");
    } catch (error) {
      // Image preparation fails before the account store can expose its own error code.
      if (!useAccountStore.getState().errorCode) {
        setLocalError(accountErrorMessage(error));
      }
      playUiSound("process-error");
    }
  };

  const submitPasswordReset = async () => {
    if (isBusy || resetCountdown > 0) return;
    const target = resetIdentifier.trim();
    if (!target) {
      setResetNotice("请输入注册邮箱或手机号。");
      return;
    }
    setResetNotice(undefined);
    setLocalError(undefined);
    clearError();
    try {
      await requestPasswordReset({ email: target });
      setResetSent(true);
      setResetCode("");
      setResetCountdown(60);
      setResetNotice(
        "验证码已发送，请在下方填写验证码和新密码。若邮件提供的是链接，请按邮件提示操作。",
      );
    } catch {
      // The store keeps the provider error in the shared account error area.
    }
  };

  const completePasswordReset = async () => {
    if (isBusy || !resetSent) return;
    clearError();
    setLocalError(undefined);
    setResetNotice(undefined);
    if (!/^\d{6}$/.test(resetCode)) {
      setLocalError("请输入 6 位验证码。");
      return;
    }
    if (
      resetPassword.length < 8 ||
      resetPassword.length > 32 ||
      !/[a-zA-Z]/.test(resetPassword) ||
      !/\d/.test(resetPassword)
    ) {
      setLocalError(accountErrorMessage("account_password_weak"));
      return;
    }
    // Form feedback only; verification and credential changes run in the provider.
    if (resetPassword !== resetConfirmation) {
      setLocalError("两次输入的新密码不一致。");
      return;
    }
    try {
      await requestPasswordReset({
        email: resetIdentifier.trim(),
        verificationCode: resetCode,
        newPassword: resetPassword,
      });
      setIdentifier(resetIdentifier.trim());
      setPassword("");
      setResetCode("");
      setResetPassword("");
      setResetConfirmation("");
      setResetSent(false);
      setResetNotice("密码已重置。请返回登录，使用新密码登录。");
    } catch {
      // Keep the form open for retry; never report success on a provider error.
    }
  };

  if (snapshot.status === "signed_in" || snapshot.status === "guest") {
    return <HomePage />;
  }

  return (
    <main className="account-page">
      <div className="account-ambient account-ambient--one" aria-hidden="true" />
      <div className="account-ambient account-ambient--two" aria-hidden="true" />
      <section className="account-card">
        <header className="account-topbar">
          <div className="account-brand">
            <BrandMark size="account" className="account-brand-mark" />
            <div>
              <span>SHANGHAO</span>
              <strong>上号</strong>
            </div>
          </div>
          <AccountAudioControl />
        </header>

        <div className="account-heading">
          <LayoutGroup id="account-mode-tabs">
            <div className="account-tabs" role="tablist" aria-label="账号操作">
              {(["login", "register"] as const).map((tabMode) => {
                const active = mode === tabMode;
                return (
                  <button
                    key={tabMode}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-ui-sound="handled"
                    className={active ? "is-active" : ""}
                    onClick={() => changeMode(tabMode)}
                  >
                    {active ? (
                      <motion.span
                        className="account-tab-pill"
                        layoutId="account-active-tab"
                        transition={{
                          duration: motionDuration.normal,
                          ease: motionCurve.spatial,
                        }}
                      />
                    ) : null}
                    <span className="account-tab-label">
                      {tabMode === "login" ? "登录" : "注册"}
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        {snapshot.status === "unavailable" || !snapshot.configured ? (
          <div className="account-inline-notice is-warning">
            {accountErrorMessage(
              snapshot.message ??
                (snapshot.configured ? "account_server_unreachable" : "account_not_configured"),
            )}
          </div>
        ) : null}

        <AnimatePresence mode="wait" initial={false}>
          <motion.form
            key={mode}
            className="account-form"
            initial={{ opacity: 0, x: reduceMotion ? 0 : modeDirection * 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduceMotion ? 0 : modeDirection * -8 }}
            transition={{
              duration: reduceMotion ? motionDuration.instant : motionDuration.compact,
              ease: motionCurve.spatial,
            }}
            onSubmit={(event) => void submit(event)}
          >
            {mode === "login" && !isResetOpen ? (
              <AccountLoginSummary
                profile={rememberedProfile}
                identifier={identifier}
                isRemembered={
                  Boolean(rememberedIdentifier) && rememberedIdentifier === identifier.trim()
                }
              />
            ) : null}

            {mode === "login" && !isResetOpen ? (
              <label className="account-field">
                <span>账号 / 手机号</span>
                <div>
                  <UserRound />
                  <input
                    autoFocus
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="输入账号或手机号"
                  />
                </div>
              </label>
            ) : null}

            {mode === "register" ? (
              <>
                <div className="account-avatar-section">
                  <div className="account-avatar-heading">
                    <strong>选择头像（必选）</strong>
                  </div>
                  <div className="account-avatar-presets" role="radiogroup" aria-label="默认头像">
                    {ACCOUNT_AVATAR_PRESETS.map((preset) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selectedAvatarPresetId === preset.id}
                        className={selectedAvatarPresetId === preset.id ? "is-selected" : ""}
                        key={preset.id}
                        title={preset.name}
                        onClick={() => {
                          setSelectedAvatarPresetId(preset.id);
                          setLocalError(undefined);
                          playUiSound("settings-section");
                        }}
                      >
                        <img src={preset.source} alt={preset.name} />
                        <AnimatePresence initial={false}>
                          {selectedAvatarPresetId === preset.id ? (
                            <motion.span
                              className="account-avatar-check"
                              initial={{ opacity: 0, scale: 0.4, rotate: -20 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0 }}
                              exit={{ opacity: 0, scale: 0.5 }}
                              transition={{ type: "spring", ...motionSpring.compact }}
                            >
                              <Check aria-hidden="true" />
                            </motion.span>
                          ) : null}
                        </AnimatePresence>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="account-register-grid">
                  <label className="account-field">
                    <span>账号</span>
                    <div>
                      <UserRound />
                      <input
                        autoFocus
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={25}
                        title={CLOUDBASE_USERNAME_MESSAGE}
                        value={username}
                        onChange={(event) => {
                          setUsername(event.target.value);
                          setLocalError(undefined);
                          clearError();
                        }}
                        placeholder="6～25 位小写账号"
                      />
                    </div>
                  </label>
                  <label className="account-field">
                    <span>昵称（可选）</span>
                    <div>
                      <UserRound />
                      <input
                        autoComplete="nickname"
                        maxLength={32}
                        value={displayName}
                        onChange={(event) => {
                          setDisplayName(event.target.value);
                          setLocalError(undefined);
                          clearError();
                        }}
                        placeholder={username || "朋友看到的名字"}
                      />
                    </div>
                  </label>
                </div>
              </>
            ) : null}

            {mode === "register" ? (
              <div className={mode === "register" ? "account-register-grid" : undefined}>
                <label className="account-field">
                  <span>手机号</span>
                  <div className="account-phone-control">
                    <Smartphone />
                    <span className="account-phone-prefix" aria-hidden="true">
                      +86
                    </span>
                    <input
                      autoComplete="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(event) => {
                        setPhone(normalizePhoneInput(event.target.value));
                        setLocalError(undefined);
                        clearError();
                      }}
                      placeholder="输入 11 位手机号"
                    />
                  </div>
                </label>
                <label className="account-field">
                  <span>验证码</span>
                  <div className="account-verification-control">
                    <input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(event) => {
                        setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                        setLocalError(undefined);
                        clearError();
                      }}
                      placeholder="6 位验证码"
                    />
                    <button
                      type="button"
                      className="account-code-action"
                      disabled={isBusy || verificationCountdown > 0 || !phone.trim()}
                      onClick={() => {
                        setLocalError(undefined);
                        clearError();
                        // Reject locally before spending an SMS on an account
                        // that the provider cannot create. Do not rename it.
                        if (!isValidCloudBaseUsername(username)) {
                          setLocalError(accountErrorMessage("account_username_invalid"));
                          playUiSound("process-error");
                          return;
                        }
                        void requestVerificationCode(phone.trim())
                          .then(() => {
                            setVerificationCountdown(60);
                            playUiSound("account-success");
                          })
                          .catch(() => playUiSound("process-error"));
                      }}
                    >
                      {verificationCountdown > 0 ? `${verificationCountdown}s` : "获取验证码"}
                    </button>
                  </div>
                </label>
                <label className="account-field">
                  <span>密码</span>
                  <div>
                    <LockKeyhole />
                    <input
                      autoComplete="new-password"
                      maxLength={32}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setLocalError(undefined);
                        clearError();
                      }}
                      placeholder="8～32 位，包含字母和数字"
                    />
                    <button
                      type="button"
                      className="account-password-toggle"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </label>
                <label className="account-field">
                  <span>确认密码</span>
                  <div>
                    <LockKeyhole />
                    <input
                      autoComplete="new-password"
                      maxLength={32}
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        setLocalError(undefined);
                        clearError();
                      }}
                      placeholder="再次输入密码"
                    />
                  </div>
                </label>
              </div>
            ) : !isResetOpen ? (
              <label className="account-field">
                <span>密码</span>
                <div>
                  <LockKeyhole />
                  <input
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="输入密码"
                  />
                  <button
                    type="button"
                    className="account-password-toggle"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </label>
            ) : null}

            {mode === "login" ? (
              <>
                {!isResetOpen ? (
                  <div className="account-login-actions">
                    <label className="account-remember-me">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(event) => setRememberMe(event.target.checked)}
                      />
                      <span>记住密码</span>
                    </label>
                    <button
                      type="button"
                      className="account-text-action"
                      disabled={isBusy}
                      onClick={() => {
                        setResetIdentifier(identifier);
                        setResetNotice(undefined);
                        setResetSent(false);
                        setResetCode("");
                        setResetPassword("");
                        setResetConfirmation("");
                        setLocalError(undefined);
                        setIsResetOpen((current) => !current);
                        clearError();
                      }}
                    >
                      忘记密码？
                    </button>
                  </div>
                ) : null}
                {isResetOpen ? (
                  <div className="account-reset-panel">
                    <label className="account-field">
                      <span>找回账号</span>
                      <div>
                        <UserRound />
                        <input
                          autoFocus
                          autoComplete="username"
                          value={resetIdentifier}
                          disabled={isBusy}
                          onChange={(event) => {
                            setResetIdentifier(event.target.value);
                            setResetSent(false);
                            setResetCode("");
                            setResetNotice(undefined);
                            clearError();
                          }}
                          placeholder="注册邮箱或手机号"
                        />
                      </div>
                    </label>
                    <Button
                      type="button"
                      className="account-reset-submit"
                      disabled={isBusy || resetCountdown > 0 || !resetIdentifier.trim()}
                      onClick={() => void submitPasswordReset()}
                    >
                      {resetCountdown > 0 ? `${resetCountdown}s 后可重新发送` : "发送验证码"}
                    </Button>
                    <p className="account-field-hint">先发送验证码，再填写验证码和两次新密码。</p>
                    <>
                      <label className="account-field">
                        <span>重置验证码</span>
                        <div>
                          <input
                            autoComplete="one-time-code"
                            inputMode="numeric"
                            maxLength={6}
                            value={resetCode}
                            disabled={isBusy}
                            onChange={(event) =>
                              setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                            }
                            placeholder="输入收到的 6 位验证码"
                          />
                        </div>
                      </label>
                      <label className="account-field">
                        <span>新密码</span>
                        <div>
                          <input
                            type="password"
                            autoComplete="new-password"
                            maxLength={32}
                            value={resetPassword}
                            disabled={isBusy}
                            onChange={(event) => setResetPassword(event.target.value)}
                            placeholder="8～32 位，包含字母和数字"
                          />
                        </div>
                      </label>
                      <label className="account-field">
                        <span>确认新密码</span>
                        <div>
                          <input
                            type="password"
                            autoComplete="new-password"
                            maxLength={32}
                            value={resetConfirmation}
                            disabled={isBusy}
                            onChange={(event) => setResetConfirmation(event.target.value)}
                            placeholder="再次输入新密码"
                          />
                        </div>
                      </label>
                      <Button
                        type="button"
                        disabled={
                          isBusy ||
                          !resetSent ||
                          resetCode.length !== 6 ||
                          !resetPassword ||
                          !resetConfirmation
                        }
                        onClick={() => void completePasswordReset()}
                      >
                        {isBusy ? "正在验证并重置…" : "确认重置密码"}
                      </Button>
                    </>
                    <button
                      type="button"
                      className="account-text-action"
                      disabled={isBusy}
                      onClick={() => {
                        setIsResetOpen(false);
                        setResetCode("");
                        setResetPassword("");
                        setResetConfirmation("");
                        clearError();
                        setLocalError(undefined);
                      }}
                    >
                      返回登录
                    </button>
                    {resetNotice ? (
                      <div className="account-inline-notice is-success">{resetNotice}</div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            <AnimatePresence initial={false}>
              {effectiveError ? (
                <motion.div
                  key={effectiveError}
                  className="account-inline-notice is-error"
                  role="alert"
                  initial={{ opacity: 0, y: -3 }}
                  animate={
                    reduceMotion ? { opacity: 1, y: 0 } : { opacity: 1, y: 0, x: [0, -4, 4, -2, 0] }
                  }
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: motionDuration.normal, ease: motionCurve.spatial }}
                >
                  {effectiveError}
                </motion.div>
              ) : null}
            </AnimatePresence>
            {!isResetOpen ? (
              <Button
                type="submit"
                hidden={isResetOpen}
                disabled={!canSubmit || isResetOpen}
                className="account-submit"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={isBusy ? "busy" : mode}
                    className="account-submit-state"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: motionDuration.fast, ease: motionCurve.enter }}
                  >
                    {isBusy ? (
                      <>
                        <LoaderCircle className="account-spinner" /> 正在处理…
                      </>
                    ) : mode === "login" ? (
                      "登录并上号"
                    ) : (
                      "创建账号"
                    )}
                  </motion.span>
                </AnimatePresence>
              </Button>
            ) : null}
          </motion.form>
        </AnimatePresence>

        {snapshot.guestAllowed ? (
          <footer className="account-guest">
            <span>临时身份，不创建账号</span>
            <button type="button" disabled={isBusy} onClick={() => void continueAsGuest()}>
              以访客身份继续
            </button>
          </footer>
        ) : null}
      </section>
    </main>
  );
};
