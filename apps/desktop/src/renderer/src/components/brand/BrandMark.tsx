import brandMarkUrl from "../../assets/brand-mark.svg";

const sizeClassNames = {
  sm: "size-8",
  md: "size-10",
  lg: "size-16",
  account: "size-[46px]",
} as const;

export const BrandMark = ({
  size = "md",
  className = "",
}: {
  size?: keyof typeof sizeClassNames;
  className?: string;
}) => (
  <div
    className={`flex items-center justify-center overflow-hidden ${sizeClassNames[size]} ${className}`}
  >
    <img
      alt="上号"
      src={brandMarkUrl}
      className="block size-full object-contain"
      draggable={false}
    />
  </div>
);
