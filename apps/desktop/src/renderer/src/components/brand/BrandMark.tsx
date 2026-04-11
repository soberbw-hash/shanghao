import brandMarkUrl from "../../assets/brand-mark.svg";

const sizeClassNames = {
  sm: "h-8 w-8 rounded-[12px]",
  md: "h-10 w-10 rounded-[14px]",
  lg: "h-12 w-12 rounded-[16px]",
} as const;

export const BrandMark = ({
  size = "md",
}: {
  size?: keyof typeof sizeClassNames;
}) => (
  <div
    className={`flex items-center justify-center border border-white/8 bg-white/[0.03] shadow-[0_16px_40px_rgba(0,0,0,0.24)] ${sizeClassNames[size]}`}
  >
    <img
      alt="上号"
      src={brandMarkUrl}
      className="h-full w-full rounded-[inherit] object-cover"
      draggable={false}
    />
  </div>
);
