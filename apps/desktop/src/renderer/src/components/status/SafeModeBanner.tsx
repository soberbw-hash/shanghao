import { ShieldAlert, X } from "lucide-react";

import { Button } from "../base/Button";
import type { StartupIssue } from "../../store/appStore";

export const SafeModeBanner = ({
  issue,
  onRetry,
  onDismiss,
}: {
  issue?: StartupIssue;
  onRetry: () => void;
  onDismiss: () => void;
}) => {
  if (!issue) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-50 w-[min(680px,calc(100vw-32px))] -translate-x-1/2">
      <div className="pointer-events-auto flex items-start gap-3 rounded-[18px] border border-[#FDE7B0] bg-[#FFFAEB] px-4 py-3 shadow-[0_12px_28px_rgba(17,24,39,0.08)]">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#B45309]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[#111827]">{issue.title}</div>
          <div className="mt-1 text-sm leading-6 text-[#667085]">{issue.description}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" className="h-9 px-3 text-xs" onClick={onRetry}>
            重试
          </Button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#98A2B3] transition hover:bg-white hover:text-[#111827]"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
