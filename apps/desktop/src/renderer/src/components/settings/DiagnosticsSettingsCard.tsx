import type { DiagnosticsSnapshot } from "@private-voice/shared";

import { SettingsSection } from "./SettingsSection";

export const DiagnosticsSettingsCard = ({
  diagnostics,
}: {
  diagnostics?: DiagnosticsSnapshot;
}) => (
  <SettingsSection title="诊断与日志" description="关键事件会落盘，方便定位设备和连接问题。">
    <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-4 text-sm text-white/55">
      <div>日志目录：{diagnostics?.logsDirectory || "正在读取..."}</div>
      <div className="mt-2">最近一次导出：{diagnostics?.lastExportPath || "还没有导出记录"}</div>
    </div>
  </SettingsSection>
);
