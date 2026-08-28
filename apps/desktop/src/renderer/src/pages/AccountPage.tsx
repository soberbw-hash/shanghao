import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, LoaderCircle, LockKeyhole, Smartphone, UserRound } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";

import {
  CLOUDBASE_USERNAME_MESSAGE,
  isValidCloudBaseUsername,
} from "../../../common/cloudbase-username";

import { Button } from "../components/base/Button";
import { BrandMark } from "../components/brand/BrandMark";
import { ACCOUNT_AVATAR_PRESETS } from "../features/account/accountAvatarPresets";
import { accountErrorMessage } from "../features/account/accountMessages";
import { playUiSound } from "../features/audio/uiSound";
import { motionCurve, motionDuration, motionSpring } from "../features/motion/motionSystem";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useAccountStore } from "../store/accountStore";
import { useSettingsStore } from "../store/settingsStore";

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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState(
    ACCOUNT_AVATAR_PRESETS[0]?.id,
  );
  const [localError, setLocalError] = useState<string>();
  const accountServiceReady = snapshot.configured && snapshot.status !== "unavailable";

  useEffect(() => {
    if (verificationCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setVerificationCountdown((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [verificationCountdown]);

  const effectiveError = localError ?? (errorCode ? accountErrorMessage(errorCode) : undefined);
  const title = mode === "login" ? "欢迎回来" : "创建上号账号";
  const subtitle =
    mode === "login"
      ? "登录后，你的身份会在不同电脑上保持一致。"
      : "手机号验证后即可创建账号，昵称以后可以修改。";

  const canSubmit = useMemo(() => {
    if (isBusy || !accountServiceReady) return false;
    if (mode === "login") return Boolean(identifier.trim() && password);
    return Boolean(
      phone.trim() &&
      /^\d{6}$/.test(verificationCode.trim()) &&
      username.trim() &&
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
    username,
    verificationCode,
  ]);

  const changeMode = (next: AccountMode) => {
    if (next === mode) return;
    clearError();
    setLocalError(undefined);
    setModeDirection(accountModeOrder[next] >= accountModeOrder[mode] ? 1 : -1);
    setMode(next);
    playUiSound("settings-section");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(undefined);
    try {
      if (mode === "login") {
        await login({ identifier: identifier.trim(), password });
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
      await register({
        username: username.trim(),
        phone: phone.trim(),
        verificationCode: verificationCode.trim(),
        password,
        displayName: displayName.trim() || username.trim(),
      });
      // CloudBase's built-in user profile has no avatar field. Keep the selected
      // preset in local settings so it is available immediately and after restart.
      if (selectedAvatarPresetId) {
        await saveSettings({ accountAvatarPresetId: selectedAvatarPresetId });
      }
      playUiSound("account-success");
    } catch {
      // The store exposes a stable user-facing error code; raw IPC details stay out of the UI.
      playUiSound("process-error");
    }
  };

  return (
    <main className="account-page">
      <div className="account-ambient account-ambient--one" aria-hidden="true" />
      <div className="account-ambient account-ambient--two" aria-hidden="true" />
      <section className="account-card">
        <header className="account-brand">
          <BrandMark size="account" className="account-brand-mark" />
          <div>
            <span>SHANGHAO</span>
            <strong>上号</strong>
          </div>
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
          <p>{subtitle}</p>
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
            {mode === "login" ? (
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
                    <strong>选择头像</strong>
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
            ) : (
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
            )}

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
            <AnimatePresence initial={false}></AnimatePresence>

            <Button type="submit" disabled={!canSubmit} className="account-submit">
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
          </motion.form>
        </AnimatePresence>

        {snapshot.guestAllowed ? (
          <footer className="account-guest">
            <span>仅限本地开发测试</span>
            <button type="button" disabled={isBusy} onClick={() => void continueAsGuest()}>
              以访客身份继续
            </button>
          </footer>
        ) : null}
      </section>
    </main>
  );
};
