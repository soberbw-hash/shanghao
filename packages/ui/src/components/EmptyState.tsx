import type { ReactNode } from "react";

export const EmptyState = ({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-[16px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center">
    <div className="text-base font-medium text-white">{title}</div>
    <p className="max-w-sm text-sm leading-6 text-white/55">{description}</p>
    {action}
  </div>
);
