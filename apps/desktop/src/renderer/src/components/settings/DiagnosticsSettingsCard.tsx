import type { DiagnosticsSnapshot } from "@private-voice/shared";

import { SettingsSection } from "./SettingsSection";

export const DiagnosticsSettingsCard = ({
  diagnostics,
}: {
  diagnostics?: DiagnosticsSnapshot;
}) => (
  <SettingsSection title="诊断" description="日志会落盘，方便排查设备和连接问题。">
    <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 text-sm text-[#667085]">
      <div>日志目录：{diagnostics?.logsDirectory || "读取中…"}</div>
      <div className="mt-2">最近导出：{diagnostics?.lastExportPath || "还没有导出记录"}</div>
    </div>
  </SettingsSection>
);
