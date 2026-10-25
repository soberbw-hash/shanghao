import { useEffect, useRef, useState } from "react";
import type { BuiltInAvatarId } from "@private-voice/shared";
import foxPortrait from "../../assets/account-avatars/03-peach-fox.svg";
import catPortrait from "../../assets/account-avatars/01-sky-cat.svg";
import duckPortrait from "../../assets/account-avatars/05-sun-duck.svg";
import pandaPortrait from "../../assets/account-avatars/09-cloud-panda.svg";
import dogPortrait from "../../assets/account-avatars/08-amber-dog.svg";

// Keep the existing scene id as a legacy fallback; the normalized portrait travels
// in avatarDataUrl so older clients render the same chosen channel avatar.
const portraits = [
  { id: "fox", label: "蜜桃狐", source: foxPortrait },
  { id: "cat", label: "晴空猫", source: catPortrait },
  { id: "duck", label: "太阳鸭", source: duckPortrait },
  { id: "panda", label: "云朵熊猫", source: pandaPortrait },
  { id: "corgi", label: "琥珀犬", source: dogPortrait },
] as const;

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
  const [selectedPortrait, setSelectedPortrait] = useState<BuiltInAvatarId>();
  const selection = useRef(0);
  useEffect(
    () => () => {
      ++selection.current;
    },
    [],
  );
  const prepare = async (input: () => Promise<string>, id: BuiltInAvatarId, preset = false) => {
    if (disabled || preparing) return;
    const generation = ++selection.current;
    setPreparing(true);
    onPreparing(true);
    try {
      const image = await window.desktopApi.temporaryRooms.prepareAvatar(await input());
      if (generation === selection.current) {
        setSelectedPortrait(preset ? id : undefined);
        onChange(id, image);
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
      avatarId,
    );
  };
  return (
    <div className="temporary-avatar-picker" role="group" aria-label="临时头像">
      <div className="temporary-avatar-portraits">
        {portraits.map((avatar) => (
          <button
            type="button"
            key={avatar.id}
            disabled={disabled || preparing}
            aria-label={`选择${avatar.label}`}
            aria-pressed={
              selectedPortrait === avatar.id ||
              (!dataUrl && !selectedPortrait && avatarId === avatar.id)
            }
            className="temporary-avatar-option"
            onClick={() => {
              void prepare(
                async () => {
                  const { prepareAccountAvatar } =
                    await import("../../features/account/prepareAccountAvatar");
                  return prepareAccountAvatar(avatar.source, "image/png", 128);
                },
                avatar.id,
                true,
              );
            }}
          >
            <img src={avatar.source} alt="" width={36} height={36} draggable={false} />
          </button>
        ))}
        {dataUrl && !selectedPortrait && (
          <img src={dataUrl} alt="自定义临时头像" width={36} height={36} className="rounded-lg" />
        )}
      </div>
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
