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
    <div className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/50 px-6">
      <div className="w-full max-w-lg rounded-[24px] border border-white/8 bg-[#111723] p-6 shadow-panel">
        <div className="text-[20px] font-semibold text-white">录音已保存</div>
        <p className="mt-2 text-sm leading-6 text-white/55">
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
