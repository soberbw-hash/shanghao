export const RecordingIndicator = ({ isVisible }: { isVisible: boolean }) =>
  isVisible ? (
    <div className="inline-flex items-center gap-2 rounded-full border border-rose-300/16 bg-rose-300/8 px-3 py-2 text-sm text-rose-100">
      <span className="h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_14px_rgba(255,87,87,0.7)]" />
      Recording in progress
    </div>
  ) : null;
