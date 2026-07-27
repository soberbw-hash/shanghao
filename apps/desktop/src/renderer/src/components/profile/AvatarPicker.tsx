import type { BuiltInAvatarId } from "@private-voice/shared";

import { avatarOptions } from "../../utils/profile";

export const CharacterPicker = ({
  value,
  onChange,
  occupiedAvatarIds = [],
}: {
  value: BuiltInAvatarId;
  onChange: (avatarId: BuiltInAvatarId) => void;
  occupiedAvatarIds?: BuiltInAvatarId[];
}) => (
  <div className="flex flex-col items-center gap-6">
    <div className="relative">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(77,163,255,0.12)_0%,transparent_70%)] scale-150" />
      <img
        src={avatarOptions.find((a) => a.id === value)?.src}
        alt=""
        className="relative h-[156px] w-[156px] object-contain"
        draggable={false}
      />
    </div>
    <div className="flex items-center gap-3">
      {avatarOptions.map((avatar) => {
        const isSelected = avatar.id === value;
        const isOccupied = occupiedAvatarIds.includes(avatar.id);
        return (
          <button
            key={avatar.id}
            type="button"
            className={`relative rounded-full p-1.5 transition-[transform,opacity,background-color] duration-150 ${
              isOccupied
                ? "cursor-not-allowed bg-[#f2f4f7] opacity-35 grayscale"
                : isSelected
                  ? "bg-[#EAF4FF]"
                  : "hover:bg-[#f5f7fb] opacity-60 hover:opacity-100"
            }`}
            disabled={isOccupied}
            aria-label={isOccupied ? "这个角色已被朋友选择" : `选择${avatar.label}`}
            title={isOccupied ? "已被朋友选择" : avatar.label}
            onClick={() => onChange(avatar.id)}
          >
            <img
              src={avatar.src}
              alt=""
              className="h-[58px] w-[58px] object-contain"
              draggable={false}
            />
            {isSelected && (
              <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[#4DA3FF]" />
            )}
            {isOccupied ? (
              <span className="absolute inset-x-1 -bottom-4 text-center text-[9px] font-semibold text-[#7b8798]">
                已占用
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  </div>
);

export const AvatarPicker = CharacterPicker;
