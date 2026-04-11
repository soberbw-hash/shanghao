import { cn } from "./cn";

interface AvatarPlaceholderProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-base",
} as const;

export const AvatarPlaceholder = ({
  name,
  src,
  size = "md",
  className,
}: AvatarPlaceholderProps) => {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-full border border-[#E7ECF2] bg-[#EEF4FF] font-semibold text-[#2B84E9]",
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        <img alt={name} src={src} className="h-full w-full object-cover" draggable={false} />
      ) : (
        initials || "上号"
      )}
    </div>
  );
};
