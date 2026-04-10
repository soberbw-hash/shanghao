import { cn } from "./cn";

interface AvatarPlaceholderProps {
  name: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-base"
} as const;

export const AvatarPlaceholder = ({
  name,
  size = "md"
}: AvatarPlaceholderProps) => {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-white/10 bg-white/8 font-semibold text-white/80",
        sizeClasses[size]
      )}
    >
      {initials || "QT"}
    </div>
  );
};
