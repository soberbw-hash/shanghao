import { Activity } from "lucide-react";

import { formatLatency } from "../../utils/format";

export const ConnectionHealthStrip = ({
  latencyMs,
  jitterMs,
  packetLossPercent,
}: {
  latencyMs: number;
  jitterMs: number;
  packetLossPercent: number;
}) => (
  <div className="flex flex-wrap items-center gap-4 rounded-[16px] border border-white/8 bg-white/5 px-4 py-3 text-sm text-white/65">
    <Activity className="h-4 w-4 text-sky-200" />
    <span>延迟 {formatLatency(latencyMs)}</span>
    <span>抖动 {formatLatency(jitterMs)}</span>
    <span>丢包 {packetLossPercent}%</span>
  </div>
);
