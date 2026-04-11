import type { PropsWithChildren, ReactNode } from "react";

export const SettingsItemRow = ({
  label,
  description,
  action,
  children,
}: PropsWithChildren<{ label: string; description?: string; action?: ReactNode }>) => (
  <div className="flex flex-col gap-3 rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="max-w-md">
      <div className="text-sm font-medium text-[#111827]">{label}</div>
      {description ? <div className="mt-1 text-sm text-[#667085]">{description}</div> : null}
    </div>
    <div className="flex min-w-[260px] items-center gap-3">{children}{action}</div>
  </div>
);
