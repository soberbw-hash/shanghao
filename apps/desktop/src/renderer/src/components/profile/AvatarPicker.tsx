import type { BuiltInAvatarId } from "@private-voice/shared";

import { avatarOptions } from "../../utils/profile";

export const AvatarPicker = ({
  value,
  onChange,
}: {
  value: BuiltInAvatarId;
  onChange: (avatarId: BuiltInAvatarId) => void;
}) => (
  <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="选择头像">
    {avatarOptions.map((avatar) => {
      const isSelected = avatar.id === value;
      return (
        <button
          key={avatar.id}
          type="button"
          role="radio"
          aria-checked={isSelected}
          title={avatar.label}
          className={`interactive-surface rounded-[16px] border p-2 ${
            isSelected
              ? "border-[#69ABF4] bg-[#F0F7FF] shadow-[0_0_0_3px_rgba(77,163,255,0.12)]"
              : "border-[#E7ECF2] bg-white"
          }`}
          onClick={() => onChange(avatar.id)}
        >
          <img src={avatar.src} alt={avatar.label} className="mx-auto h-12 w-12 rounded-[14px]" />
        </button>
      );
    })}
  </div>
);
