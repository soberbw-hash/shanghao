import { useEffect, useRef, useState } from "react";
import type { BuiltInAvatarId } from "@private-voice/shared";
import { ACCOUNT_AVATAR_PRESETS } from "../../features/account/accountAvatarPresets";

export function TemporaryAvatarPicker({
  avatarId,
  dataUrl,
  disabled,
  onChange,
  onError,
  onPreparing,
}: {
  avatarId: BuiltInAvatarId;
  dataUrl?: string;
  disabled: boolean;
  onChange: (id: BuiltInAvatarId, image?: string) => void;
  onError: (message: string) => void;
  onPreparing: (value: boolean) => void;
}) {
  const [preparing, setPreparing] = useState(false);
  const [selectedPortrait, setSelectedPortrait] = useState<string>();
  const selection = useRef(0);
  useEffect(
    () => () => {
      ++selection.current;
    },
    [],
  );
  const prepare = async (input: () => Promise<string>, presetId?: string) => {
    if (disabled || preparing) return;
    const generation = ++selection.current;
    setPreparing(true);
    onPreparing(true);
    try {
      const image = await window.desktopApi.temporaryRooms.prepareAvatar(await input());
      if (generation === selection.current) {
        setSelectedPortrait(presetId);
        // The legacy scene id remains valid for older clients; the chosen image
        // is sent separately in the normalized avatar data.
        onChange(avatarId, image);
      }
    } catch {
      if (generation === selection.current) onError("这张图片无法使用，请选择较小的普通图片。");
    } finally {
      if (generation === selection.current) {
        setPreparing(false);
        onPreparing(false);
      }
    }
  };
  const choose = async (file?: File) => {
    if (!file || disabled || preparing) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 128 * 1024) {
      onError("请选择不超过 128 KB 的 PNG 或 JPG 图片。");
      return;
    }
    await prepare(
      () =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(Error("avatar_read_failed"));
          reader.readAsDataURL(file);
        }),
    );
  };
  return (
    <div className="temporary-avatar-picker" role="group" aria-label="临时头像">
      <div className="temporary-avatar-portraits">
        {ACCOUNT_AVATAR_PRESETS.map((avatar) => (
          <button
            type="button"
            key={avatar.id}
            disabled={disabled || preparing}
            aria-label={`选择${avatar.name}`}
            aria-pressed={selectedPortrait === avatar.id}
            className="temporary-avatar-option"
            onClick={() => {
              void prepare(async () => {
                const { prepareAccountAvatar } =
                  await import("../../features/account/prepareAccountAvatar");
                return prepareAccountAvatar(avatar.source, "image/png", 128);
              }, avatar.id);
            }}
          >
            <img src={avatar.source} alt="" width={36} height={36} draggable={false} />
          </button>
        ))}
      </div>
      {dataUrl && !selectedPortrait && (
        <img src={dataUrl} alt="当前临时头像" width={36} height={36} className="rounded-lg" />
      )}
      <label className="temporary-avatar-upload">
        {preparing ? "处理图片…" : "上传头像"}
        <input
          type="file"
          aria-label="上传临时头像"
          accept="image/png,image/jpeg"
          disabled={disabled || preparing}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
