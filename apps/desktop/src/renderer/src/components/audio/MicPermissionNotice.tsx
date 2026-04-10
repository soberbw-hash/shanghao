import { MicOff } from "lucide-react";

import { InlineBanner } from "../layout/InlineBanner";

export const MicPermissionNotice = () => (
  <InlineBanner tone="warning">
    <div className="flex items-center gap-2">
      <MicOff className="h-4 w-4" />
      Microphone access is not granted yet. Voice features will stay limited until you allow it.
    </div>
  </InlineBanner>
);
