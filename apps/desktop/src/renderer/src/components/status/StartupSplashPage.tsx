import { BrandMark } from "../brand/BrandMark";

export const StartupSplashPage = ({ message }: { message: string }) => (
  <div className="flex h-full items-center justify-center px-6">
    <div className="w-full max-w-[420px] rounded-[28px] border border-[#E7ECF2] bg-white px-8 py-10 text-center shadow-[0_20px_60px_rgba(17,24,39,0.08)]">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#EEF6FF]">
        <BrandMark size="md" />
      </div>
      <div className="mt-5 text-[24px] font-semibold text-[#111827]">上号</div>
      <p className="mt-2 text-sm leading-6 text-[#667085]">{message}</p>
      <div className="mt-6 flex items-center justify-center gap-2">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#4DA3FF]" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#B9DBFF] [animation-delay:120ms]" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#D6EBFF] [animation-delay:240ms]" />
      </div>
    </div>
  </div>
);
