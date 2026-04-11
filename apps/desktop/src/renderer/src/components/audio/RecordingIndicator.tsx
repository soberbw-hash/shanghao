export const RecordingIndicator = ({ isVisible }: { isVisible: boolean }) =>
  isVisible ? (
    <div className="inline-flex items-center gap-2 rounded-full bg-[#FEF3F2] px-3 py-2 text-sm text-[#B42318]">
      <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
      录音中
    </div>
  ) : null;
