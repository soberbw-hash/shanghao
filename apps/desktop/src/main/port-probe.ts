import net from "node:net";

export const probePort = async (
  host: string,
  port: number,
  timeoutMs = 2_500,
  externalSignal?: AbortSignal,
): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    const onAbort = () => finish(false);
    if (externalSignal) {
      if (externalSignal.aborted) {
        finish(false);
        return;
      }
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    // Clean up the abort listener on natural finish.
    const cleanup = () => {
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    };
    socket.once("close", cleanup);
  });
};
