export class PrivateRoomResponseError extends Error {
  constructor(
    code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
export const privateRoomResponseError = (body: unknown, status: number): Error => {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return new PrivateRoomResponseError(
    typeof code === "string" && code.length <= 128 ? code : "room_service_unavailable",
    status,
  );
};

export const privateRoomServerUrl = (address: string | undefined, development: boolean): URL => {
  const url = new URL(address ?? "");
  if (!/^wss?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("room_server_invalid_url");
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    !development
  )
    throw new Error("account_secure_transport_required");
  url.hash = "";
  url.pathname = "/";
  return url;
};

/** Retry only an explicit authentication rejection, never an ambiguous network/write failure. */
export const requestPrivateRoomWithSession = async (
  readToken: (forceRefresh: boolean) => Promise<string | undefined>,
  assertCurrentAccount: () => void,
  request: (token: string) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<unknown> => {
  const token = async (force: boolean) => {
    signal?.throwIfAborted();
    assertCurrentAccount();
    const value = await readToken(force);
    signal?.throwIfAborted();
    assertCurrentAccount();
    if (!value) throw new Error("account_session_expired");
    return value;
  };
  const initial = await token(false);
  try {
    return await request(initial);
  } catch (error) {
    if (
      !(error instanceof PrivateRoomResponseError) ||
      error.status !== 401 ||
      error.message !== "account_session_expired"
    )
      throw error;
    return request(await token(true));
  }
};
