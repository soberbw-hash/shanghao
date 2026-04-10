import { AlertTriangle } from "lucide-react";

import { InlineBanner } from "../layout/InlineBanner";

export const DeviceHealthNotice = ({ message }: { message: string }) => (
  <InlineBanner tone="warning">
    <div className="flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" />
      {message}
    </div>
  </InlineBanner>
);
