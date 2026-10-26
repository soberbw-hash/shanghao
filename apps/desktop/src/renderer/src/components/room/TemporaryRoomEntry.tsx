import { useEffect, useRef, useState } from "react";
import "./TemporaryRoomDialogs.css";
import { UsersRound } from "lucide-react";
import type { TemporaryRoomDescriptor, BuiltInAvatarId } from "@private-voice/shared";
import { useSettingsStore } from "../../store/settingsStore";
import { useAppStore } from "../../store/appStore";
import { useAccountStore } from "../../store/accountStore";
import { temporaryRoomMessage } from "../../features/room/temporaryRoomMessages";
import { Button } from "../base/Button";
import { TemporaryAvatarPicker } from "./TemporaryAvatarPicker";
import { DialogCloseButton } from "../base/DialogCloseButton";

export function TemporaryRoomEntry({
  onJoin,
  busy = false,
}: {
  onJoin: (room: TemporaryRoomDescriptor) => Promise<void>;
  busy?: boolean;
}) {
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [avatarId, setAvatarId] = useState<BuiltInAvatarId>("fox");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string>();
  const [working, setWorking] = useState(false);
  const [preparingAvatar, setPreparingAvatar] = useState(false);
  const blocked = working || busy || preparingAvatar;
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [joining, setJoining] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!opened) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [opened]);
  const mounted = useRef(false);
  const edited = useRef(false);
  const account = useAccountStore((state) => state.snapshot);
  useEffect(() => {
    if (account.status !== "signed_in" || !account.profile || edited.current) return;
    let active = true;
    setNickname(account.profile.displayName);
    setPreparingAvatar(true);
    const profile = account.profile;
    void (async () => {
      const [{ accountProfileAvatarSource }, { prepareAccountAvatar }] = await Promise.all([
        import("../../features/account/accountAvatarPresets"),
        import("../../features/account/prepareAccountAvatar"),
      ]);
      const source = profile.avatarUrl?.startsWith("data:image/")
        ? profile.avatarUrl
        : accountProfileAvatarSource(profile);
      if (!source) return;
      const image = await window.desktopApi.temporaryRooms.prepareAvatar(
        await prepareAccountAvatar(source, "image/png", 128),
      );
      if (active && !edited.current) setAvatarDataUrl(image);
    })()
      .catch(() => {})
      .finally(() => {
        if (active) setPreparingAvatar(false);
      });
    return () => {
      active = false;
    };
  }, [account]);
  useEffect(() => {
    mounted.current = true;
    if (!window.desktopApi.temporaryRooms) return;
    void window.desktopApi.temporaryRooms
      .getProfile()
      .then((profile) => {
        if (mounted.current && !edited.current) {
          const account = useAccountStore.getState().snapshot;
          const signedIn = account.status === "signed_in";
          setNickname(
            (signedIn && account.profile?.displayName) ||
              profile?.nickname ||
              useSettingsStore.getState().settings?.nickname ||
              "",
          );
          setAvatarId(profile?.avatarId ?? useSettingsStore.getState().settings?.avatarId ?? "fox");
          if (!signedIn) setAvatarDataUrl(profile?.avatarDataUrl);
        }
      })
      .catch(() => {
        if (mounted.current) setError("临时身份读取失败，请重启上号后重试。");
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const enter = async (create: boolean) => {
    if (blocked) return;
    setWorking(true);
    setError("");
    let descriptor: TemporaryRoomDescriptor | undefined;
    try {
      await window.desktopApi.temporaryRooms.saveProfile({
        nickname: nickname.trim(),
        avatarId,
        avatarDataUrl,
      });
      descriptor = create
        ? await window.desktopApi.temporaryRooms.create()
        : await window.desktopApi.temporaryRooms.join(code);
      if (!mounted.current) {
        await window.desktopApi.temporaryRooms.release(descriptor.contextId);
        return;
      }
      await onJoin(descriptor);
      if (useAppStore.getState().currentPage !== "room")
        await window.desktopApi.temporaryRooms.release(descriptor.contextId);
    } catch (cause) {
      if (descriptor)
        await window.desktopApi.temporaryRooms.release(descriptor.contextId).catch(() => undefined);
      if (mounted.current) setError(temporaryRoomMessage(cause));
    } finally {
      if (mounted.current) setWorking(false);
    }
  };
  if (!window.desktopApi.temporaryRooms) return null;
  return (
    <div className="temporary-entry">
      <button
        type="button"
        className="temporary-entry-trigger"
        title="无需账号，优先点对点连接；跨网络可能需要发现或中继服务。"
        onClick={() => {
          setOpened(true);
          setJoining(false);
          setError("");
        }}
      >
        <UsersRound size={17} />
        <strong>临时联机</strong>
        <span>和朋友临时聊一会儿 →</span>
      </button>
      {opened && (
        <dialog
          ref={dialog}
          className="temporary-entry-dialog"
          aria-labelledby="temporary-entry-title"
          onCancel={(event) => {
            if (working) event.preventDefault();
            else setOpened(false);
          }}
        >
          <header className="temporary-dialog-header">
            <h2 id="temporary-entry-title">临时联机</h2>
            <DialogCloseButton
              disabled={working}
              onClick={() => setOpened(false)}
              label="关闭临时联机"
            />
          </header>
          <p className="temporary-dialog-hint">
            无需账号。创建后把房间码发给朋友，或输入朋友的房间码加入。
          </p>
          <div className="temporary-entry-body">
            <label>
              临时昵称
              <input
                value={nickname}
                maxLength={16}
                autoComplete="nickname"
                disabled={blocked}
                onChange={(event) => {
                  edited.current = true;
                  setNickname(event.target.value);
                }}
                placeholder="朋友怎么称呼你"
              />
            </label>
            <TemporaryAvatarPicker
              avatarId={avatarId}
              dataUrl={avatarDataUrl}
              disabled={blocked}
              onPreparing={setPreparingAvatar}
              onChange={(id, image) => {
                edited.current = true;
                setAvatarId(id);
                setAvatarDataUrl(image);
              }}
              onError={setError}
            />
            {!joining ? (
              <div className="temporary-entry-actions">
                <Button
                  type="button"
                  disabled={blocked || !nickname.trim()}
                  onClick={() => void enter(true)}
                >
                  {working ? "连接中…" : "创建临时房间"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={blocked}
                  onClick={() => {
                    setJoining(true);
                    setError("");
                  }}
                >
                  加入房间
                </Button>
              </div>
            ) : (
              <form
                className="temporary-join-action"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!blocked && code.length === 8 && nickname.trim()) void enter(false);
                }}
              >
                <label className="temporary-code-label">
                  加入已有房间
                  <input
                    inputMode="numeric"
                    autoFocus
                    value={code}
                    maxLength={32}
                    disabled={blocked}
                    placeholder="输入朋友分享的八位房间码"
                    aria-label="加入已有房间的八位房间码"
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                  />
                </label>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={blocked || code.length !== 8 || !nickname.trim()}
                >
                  {working ? "连接中…" : "确认加入"}
                </Button>
                <button
                  type="button"
                  className="temporary-entry-back"
                  disabled={blocked}
                  onClick={() => setJoining(false)}
                >
                  返回创建 / 加入
                </button>
              </form>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </dialog>
      )}
    </div>
  );
}
