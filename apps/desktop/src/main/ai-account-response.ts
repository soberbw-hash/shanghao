import { readAiProviderResponse } from "./ai-provider-response";

/** An auth rejection precedes processing: refresh once, never replay a completed inference. */
export async function fetchAiAccountResponse(
  send: (token: string) => Promise<Response>,
  token: string,
  refresh: () => Promise<string | undefined>,
  signal?: AbortSignal,
): Promise<Response> {
  let response = await send(token);
  if (response.status !== 401) return response;
  const raw = await readAiProviderResponse(response, 4096, "cloud_asr_invalid_response");
  let expired = false;
  try {
    const payload = JSON.parse(raw);
    expired = payload?.error?.code === "account_session_expired";
  } catch {
    signal?.throwIfAborted();
  }
  response = new Response(raw, { status: response.status, headers: response.headers });
  if (!expired) return response;
  signal?.throwIfAborted();
  const next = await refresh();
  signal?.throwIfAborted();
  if (!next || next === token) return response;
  await response.body?.cancel().catch(() => undefined);
  response = await send(next);
  return response;
}
