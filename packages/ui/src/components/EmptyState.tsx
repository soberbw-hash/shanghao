import type { ReactNode } from "react";

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-[16px] border border-dashed border-[#D6DEE8] bg-[#F8FAFC] p-6 text-center">
    <div className="text-base font-medium text-[#111827]">{title}</div>
    <p className="max-w-sm text-sm leading-6 text-[#667085]">{description}</p>
    {action}
  </div>
);
