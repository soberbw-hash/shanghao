import type { PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const PageContainer = ({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) => (
  <div className={cn("flex h-full flex-col gap-5 px-6 py-6", className)}>{children}</div>
);
