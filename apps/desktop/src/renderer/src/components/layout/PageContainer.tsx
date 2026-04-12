import type { PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const PageContainer = ({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) => (
  <div className={cn("flex h-full flex-col gap-3 px-4 py-3", className)}>{children}</div>
);
