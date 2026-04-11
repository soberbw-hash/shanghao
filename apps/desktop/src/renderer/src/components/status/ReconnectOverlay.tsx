import { LoaderCircle } from "lucide-react";

export const ReconnectOverlay = ({ isVisible }: { isVisible: boolean }) =>
  isVisible ? (
    <div className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-[rgba(17,24,39,0.16)] backdrop-blur-[4px]">
      <div className="flex items-center gap-3 rounded-[18px] border border-[#E7ECF2] bg-white px-5 py-4 text-sm text-[#667085] shadow-[0_18px_36px_rgba(17,24,39,0.1)]">
        <LoaderCircle className="h-4 w-4 animate-spin text-[#4DA3FF]" />
        正在重新连接房间…
      </div>
    </div>
  ) : null;
