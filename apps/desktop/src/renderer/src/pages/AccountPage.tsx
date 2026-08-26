import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Headphones,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";

import { Button } from "../components/base/Button";
import { ACCOUNT_AVATAR_PRESETS } from "../features/account/accountAvatarPresets";
import { accountErrorMessage } from "../features/account/accountMessages";
import { prepareAccountAvatar } from "../features/account/prepareAccountAvatar";
import { playUiSound } from "../features/audio/uiSound";
import { motionCurve, motionDuration, motionSpring } from "../features/motion/motionSystem";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useAccountStore } from "../store/accountStore";

type AccountMode = "login" | "register" | "reset";

const accountModeOrder: Record<AccountMode, number> = {
  reset: -1,
  login: 0,
  register: 1,
};

export const AccountPage = () => {
  const snapshot = useAccountStore((state) => state.snapshot);
  const isBusy = useAccountStore((state) => state.isBusy);
  const errorCode = useAccountStore((state) => state.errorCode);
  const login = useAccountStore((state) => state.login);
  const register = useAccountStore((state) => state.register);
  const requestPasswordReset = useAccountStore((state) => state.requestPasswordReset);
  const continueAsGuest = useAccountStore((state) => state.continueAsGuest);
  const clearError = useAccountStore((state) => state.clearError);
  const reduceMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<AccountMode>("login");
  const [modeDirection, setModeDirection] = useState(1);
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string>();
  const [selectedAvatarPresetId, setSelectedAvatarPresetId] = useState(
    ACCOUNT_AVATAR_PRESETS[0]?.id,
  );
  const [localError, setLocalError] = useState<string>();
  const [resetSent, setResetSent] = useState(false);
  const accountServiceReady = snapshot.configured && snapshot.status !== "unavailable";

  const effectiveError = localError ?? (errorCode ? accountErrorMessage(errorCode) : undefined);
  const title = mode === "login" ? "欢迎回来" : mode === "register" ? "创建上号账号" : "找回密码";
  const subtitle =
    mode === "login"
      ? "登录后，你的身份会在不同电脑上保持一致。"
      : mode === "register"
        ? "用户名是唯一登录名，显示名以后可以修改。"
        : "输入注册邮箱，我们会发送重置链接。";

  const canSubmit = useMemo(() => {
    if (isBusy || !accountServiceReady) return false;
    if (mode === "login") return Boolean(identifier.trim() && password);
    if (mode === "reset") return Boolean(email.trim());
    return Boolean(username.trim() && email.trim() && password && confirmPassword);
  }, [accountServiceReady, confirmPassword, email, identifier, isBusy, mode, password, username]);

  const changeMode = (next: AccountMode) => {
    if (next === mode) return;
    clearError();
    setLocalError(undefined);
    setResetSent(false);
    setModeDirection(accountModeOrder[next] >= accountModeOrder[mode] ? 1 : -1);
    setMode(next);
    playUiSound("settings-section");
  };

  const selectAvatar = async () => {
    const picked = await window.desktopApi.profile.pickAvatar();
    if (!picked) return;
    try {
      setAvatarDataUrl(await prepareAccountAvatar(picked.avatarDataUrl));
      setSelectedAvatarPresetId(undefined);
      setLocalError(undefined);
      playUiSound("settings-section");
    } catch (error) {
      setLocalError(accountErrorMessage(error));
    }
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
      if (mode === "reset") {
        await requestPasswordReset({ email: email.trim() });
        setResetSent(true);
        playUiSound("account-success");
        return;
      }
      // This comparison only provides immediate form feedback; credentials are validated by Supabase.
      // eslint-disable-next-line security/detect-possible-timing-attacks
      if (password !== confirmPassword) {
        setLocalError("两次输入的密码不一致，请重新确认。");
        playUiSound("process-error");
        return;
      }
      const selectedPreset = ACCOUNT_AVATAR_PRESETS.find(
        (preset) => preset.id === selectedAvatarPresetId,
      );
      const preparedAvatar =
        avatarDataUrl ??
        (selectedPreset ? await prepareAccountAvatar(selectedPreset.source) : undefined);
      await register({
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        displayName: displayName.trim() || username.trim(),
        avatarDataUrl: preparedAvatar,
      });
      playUiSound("account-success");
    } catch {
      // The store exposes a stable user-facing error code; raw IPC details stay out of the UI.
      playUiSound("process-error");
    }
  };

  if (snapshot.status === "verification_required") {
    return (
      <main className="account-page">
        <section className="account-card account-card--message" aria-live="polite">
          <div className="account-brand-mark">
            <Mail />
          </div>
          <h1>请查收验证邮件</h1>
          <p>我们已向 {snapshot.profile?.email ?? "你的邮箱"} 发送验证邮件。完成验证后即可登录。</p>
          <Button onClick={() => changeMode("login")}>返回登录</Button>
        </section>
      </main>
    );
  }

  return (
    <main className="account-page">
      <div className="account-ambient account-ambient--one" aria-hidden="true" />
      <div className="account-ambient account-ambient--two" aria-hidden="true" />
      <section className="account-card">
        <header className="account-brand">
          <div className="account-brand-mark">
            <Headphones />
          </div>
          <div>
            <span>SHANGHAO</span>
            <strong>上号</strong>
          </div>
        </header>

        <div className="account-heading">
          {mode === "reset" ? (
            <button type="button" className="account-back" onClick={() => changeMode("login")}>
              <ArrowLeft /> 返回登录
            </button>
          ) : (
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
          )}
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
                <span>用户名或邮箱</span>
                <div>
                  <UserRound />
                  <input
                    autoFocus
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="输入用户名或邮箱"
                  />
                </div>
              </label>
            ) : null}

            {mode === "register" ? (
              <>
                <div className="account-avatar-section">
                  <div className="account-avatar-heading">
                    <div>
                      <strong>选择头像</strong>
                      <span>选一个默认头像，或上传自己的图片</span>
                    </div>
                    <button
                      type="button"
                      className={`account-avatar-upload ${avatarDataUrl ? "is-selected" : ""}`}
                      onClick={() => void selectAvatar()}
                    >
                      {avatarDataUrl ? (
                        <img src={avatarDataUrl} alt="自己上传的头像" />
                      ) : (
                        <ImagePlus />
                      )}
                      <span>{avatarDataUrl ? "已上传" : "上传"}</span>
                    </button>
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
                          setAvatarDataUrl(undefined);
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
                    <span>用户名</span>
                    <div>
                      <UserRound />
                      <input
                        autoFocus
                        autoComplete="username"
                        value={username}
                        onChange={(event) =>
                          setUsername(
                            event.target.value.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase(),
                          )
                        }
                        placeholder="3～20 位英文、数字或下划线"
                      />
                    </div>
                  </label>
                  <label className="account-field">
                    <span>显示名（可选）</span>
                    <div>
                      <UserRound />
                      <input
                        autoComplete="nickname"
                        maxLength={32}
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={username || "朋友看到的名字"}
                      />
                    </div>
                  </label>
                </div>
              </>
            ) : null}

            {mode !== "login" ? (
              <div className={mode === "register" ? "account-register-grid" : undefined}>
                <label className="account-field">
                  <span>邮箱</span>
                  <div>
                    <Mail />
                    <input
                      autoComplete="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                    />
                  </div>
                </label>
                {mode !== "reset" ? (
                  <label className="account-field">
                    <span>密码</span>
                    <div>
                      <LockKeyhole />
                      <input
                        autoComplete="new-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={mode === "register" ? "至少 8 位" : "输入密码"}
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
                {mode === "register" ? (
                  <label className="account-field">
                    <span>确认密码</span>
                    <div>
                      <LockKeyhole />
                      <input
                        autoComplete="new-password"
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="再次输入密码"
                      />
                    </div>
                  </label>
                ) : null}
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
            <AnimatePresence initial={false}>
              {resetSent ? (
                <motion.div
                  className="account-inline-notice is-success"
                  role="status"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: motionDuration.compact, ease: motionCurve.enter }}
                >
                  如果该邮箱已注册，重置邮件已发送。请检查收件箱和垃圾邮件。
                </motion.div>
              ) : null}
            </AnimatePresence>

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
                  ) : mode === "register" ? (
                    "创建账号"
                  ) : (
                    "发送重置邮件"
                  )}
                </motion.span>
              </AnimatePresence>
            </Button>
            {mode === "login" ? (
              <button
                type="button"
                className="account-text-action"
                onClick={() => changeMode("reset")}
              >
                忘记密码？
              </button>
            ) : null}
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
