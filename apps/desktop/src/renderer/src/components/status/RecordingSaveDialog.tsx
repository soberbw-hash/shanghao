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
        <div className="text-[20px] font-semibold text-white">Recording saved</div>
        <p className="mt-2 text-sm leading-6 text-white/55">
          {filePath || "Your room recording was exported to an .m4a file."}
        </p>
        <div className="mt-5">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  ) : null;
