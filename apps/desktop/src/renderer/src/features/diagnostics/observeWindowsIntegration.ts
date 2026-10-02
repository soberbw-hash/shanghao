import type { WindowsIntegrationStatus } from "@private-voice/shared";

/** One request at a time, only while the owning settings section is visible. */
export const observeWindowsIntegration = (
  onStatus: (status: WindowsIntegrationStatus) => void,
  onSettled: () => void,
  onError: () => void,
  read = () => window.desktopApi.windows.getStatus(),
): (() => void) => {
  let active = true;
  let timer: ReturnType<typeof setTimeout>;
  let delay = 30_000;
  const poll = async () => {
    try {
      const status = await read();
      if (!active) return;
      delay = status.firewall.repairState === "repairing" ? 2_000 : 30_000;
      onStatus(status);
    } catch {
      delay = 30_000;
      if (active) onError();
    } finally {
      if (active) {
        onSettled();
        timer = setTimeout(() => void poll(), delay);
      }
    }
  };
  void poll();
  return () => {
    active = false;
    clearTimeout(timer);
  };
};
