import type { BuiltInAvatarId } from "@private-voice/shared";

import { avatarOptions } from "../../utils/profile";

export const AvatarPicker = ({
  value,
  onChange,
}: {
  value: BuiltInAvatarId;
  onChange: (avatarId: BuiltInAvatarId) => void;
}) => (
  <div className="grid grid-cols-5 gap-3" role="radiogroup" aria-label="选择角色">
    {avatarOptions.map((avatar) => {
      const isSelected = avatar.id === value;
      return (
        <button
          key={avatar.id}
          type="button"
          role="radio"
          aria-checked={isSelected}
          title={avatar.label}
          className={`interactive-surface rounded-[18px] p-1.5 ${
            isSelected
              ? "bg-[#F0F7FF] shadow-[0_0_0_3px_rgba(77,163,255,0.14)]"
              : "hover:bg-white/60"
          }`}
          onClick={() => onChange(avatar.id)}
        >
          <img src={avatar.src} alt={avatar.label} className="mx-auto h-[76px] w-[76px] object-contain" />
        </button>
      );
    })}
  </div>
);
