/** Shared bounded HTTP transport; room command policy and account scope stay with the owner. */
export const requestPrivateRoom = async (
  fetcher: typeof fetch,
  url: URL,
  token: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> => {
  signal?.throwIfAborted();
  const response = await fetcher(url.toString(), {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (response.status === 404 && !response.headers.get("content-type")?.includes("json")) {
    await response.body?.cancel();
    throw new Error("room_server_upgrade_required");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) throw new Error("room_server_invalid_response");
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 512 * 1024) throw new Error("room_server_invalid_response");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let result: unknown;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("room_server_invalid_response");
  }
  if (!response.ok) {
    const code = (result as { error?: { code?: unknown } } | null)?.error?.code;
    throw new Error(
      typeof code === "string" && code.length <= 128 ? code : "room_service_unavailable",
    );
  }
  return result;
};
