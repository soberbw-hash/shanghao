import type { DiagnosticsSnapshot } from "@private-voice/shared";

import { SettingsSection } from "./SettingsSection";

export const DiagnosticsSettingsCard = ({
  diagnostics,
}: {
  diagnostics?: DiagnosticsSnapshot;
}) => (
  <SettingsSection title="Diagnostics & logs" description="Core events are written locally for troubleshooting.">
    <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/55">
      <div>Log directory: {diagnostics?.logsDirectory || "Loading..."}</div>
      <div className="mt-2">Last export: {diagnostics?.lastExportPath || "No export yet"}</div>
    </div>
  </SettingsSection>
);
