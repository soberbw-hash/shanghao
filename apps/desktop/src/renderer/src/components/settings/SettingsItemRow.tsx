import type { PropsWithChildren, ReactNode } from "react";

export const SettingsItemRow = ({
  label,
  description,
  action,
  children,
}: PropsWithChildren<{ label: string; description?: string; action?: ReactNode }>) => (
  <div className="settings-item-row flex flex-col gap-3 rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="settings-item-copy max-w-md">
      <div className="settings-item-label text-sm font-medium text-[#111827]">{label}</div>
      {description ? (
        <div className="settings-item-description mt-1 text-sm text-[#667085]">{description}</div>
      ) : null}
    </div>
    <div className="settings-item-action flex min-w-[260px] items-center gap-3">
      {children}
      {action}
    </div>
  </div>
);
