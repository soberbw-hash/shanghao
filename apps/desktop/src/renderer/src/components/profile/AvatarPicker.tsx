import type { BuiltInAvatarId } from "@private-voice/shared";

import { avatarOptions } from "../../utils/profile";

export const CharacterPicker = ({
  value,
  onChange,
}: {
  value: BuiltInAvatarId;
  onChange: (avatarId: BuiltInAvatarId) => void;
}) => (
  <div className="grid grid-cols-5 gap-4" role="radiogroup" aria-label="选择角色">
    {avatarOptions.map((avatar) => {
      const isSelected = avatar.id === value;
      return (
        <button
          key={avatar.id}
          type="button"
          role="radio"
          aria-checked={isSelected}
          className={`relative rounded-full p-2 transition-all duration-200 ${
            isSelected
              ? "bg-[#eff6ff] shadow-[0_0_0_2px_rgba(59,130,246,0.3),0_0_16px_rgba(59,130,246,0.15)]"
              : "hover:bg-white/50"
          }`}
          onClick={() => onChange(avatar.id)}
        >
          <img src={avatar.src} alt="" className="mx-auto h-[110px] w-[110px] object-contain" draggable={false} />
          {isSelected && (
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />
          )}
        </button>
      );
    })}
  </div>
);

export const AvatarPicker = CharacterPicker;
