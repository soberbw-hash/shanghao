import { LoaderCircle } from "lucide-react";

export const ReconnectOverlay = ({ isVisible }: { isVisible: boolean }) =>
  isVisible ? (
    <div className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-[#06090d]/50">
      <div className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-[#111723] px-5 py-4 text-sm text-white/75">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        正在重新连接房间...
      </div>
    </div>
  ) : null;
