import { useEffect, useState } from "react";

import { formatDuration } from "@private-voice/shared";

export const RecordingTimer = ({
  durationMs,
  startedAt,
}: {
  durationMs: number;
  startedAt?: number;
}) => {
  const [liveDuration, setLiveDuration] = useState(durationMs);

  useEffect(() => {
    setLiveDuration(durationMs);

    if (!startedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setLiveDuration(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(timer);
  }, [durationMs, startedAt]);

  return (
    <span className="rounded-full border border-rose-300/16 bg-rose-300/8 px-3 py-2 text-sm font-medium text-rose-100">
      {formatDuration(liveDuration)}
    </span>
  );
};
