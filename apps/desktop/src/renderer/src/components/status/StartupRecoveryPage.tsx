import { RefreshCcw, Shield } from "lucide-react";

import type { StartupIssue } from "../../store/appStore";
import { Button } from "../base/Button";
import { BrandMark } from "../brand/BrandMark";

export const StartupRecoveryPage = ({
  issue,
  onRetry,
  onContinue,
}: {
  issue?: StartupIssue;
  onRetry: () => void;
  onContinue: () => void;
}) => (
  <div className="flex h-full items-center justify-center px-6 py-10">
    <div className="w-full max-w-[560px] rounded-[28px] border border-[#E7ECF2] bg-white p-8 shadow-[0_20px_60px_rgba(17,24,39,0.08)]">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#EEF6FF]">
          <BrandMark size="md" />
        </div>
        <div>
          <div className="text-[24px] font-semibold text-[#111827]">
            {issue?.title ?? "上号启动失败"}
          </div>
          <div className="mt-1 text-sm text-[#667085]">
            {issue?.description ?? "这次启动没有完成。你可以重试，或者先进入安全模式。"}
          </div>
        </div>
      </div>
      {issue?.details?.length ? (
        <div className="mt-6 rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
          <div className="text-xs font-medium uppercase tracking-[0.22em] text-[#98A2B3]">
            启动信息
          </div>
          <div className="mt-3 space-y-2 text-sm text-[#667085]">
            {issue.details.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={onRetry}>
          <RefreshCcw className="h-4 w-4" />
          重新加载
        </Button>
        <Button variant="secondary" onClick={onContinue}>
          <Shield className="h-4 w-4" />
          进入安全模式
        </Button>
      </div>
    </div>
  </div>
);
