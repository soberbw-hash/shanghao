import { Button } from "../base/Button";

export const RecordingSaveDialog = ({
  isOpen,
  filePath,
  onClose,
}: {
  isOpen: boolean;
  filePath?: string;
  onClose: () => void;
}) =>
  isOpen ? (
    <div className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-[rgba(17,24,39,0.18)] px-6 backdrop-blur-[4px]">
      <div className="w-full max-w-lg rounded-[24px] border border-[#E7ECF2] bg-white p-6 shadow-[0_24px_48px_rgba(17,24,39,0.12)]">
        <div className="text-[20px] font-semibold text-[#111827]">录音已保存</div>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          {filePath || "房间录音已经导出为 .m4a 文件。"}
        </p>
        <div className="mt-5">
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  ) : null;
