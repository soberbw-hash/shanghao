import brandMarkUrl from "../../assets/brand-mark.svg";

const sizeClassNames = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-16 w-16",
} as const;

export const BrandMark = ({ size = "md" }: { size?: keyof typeof sizeClassNames }) => (
  <div className={`flex items-center justify-center overflow-hidden ${sizeClassNames[size]}`}>
    <img alt="上号" src={brandMarkUrl} className="h-full w-full object-contain" draggable={false} />
  </div>
);
