/** CloudBase can report malformed JWTs as HTTP 400; unrelated provider failures stay retryable. */
export const isInvalidCloudBaseTokenResponse = (status: number, body: unknown): boolean => {
  if (status === 401 || status === 403) return true;
  if (status !== 400 || !body || typeof body !== "object") return false;
  const envelope = body as Record<string, unknown>;
  const error = envelope.error;
  const nested = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const code = envelope.code ?? nested.code ?? error;
  if (code === "invalid_token") return true;
  const description = [envelope.message, envelope.error_description, nested.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .slice(0, 1_024);
  return /(?:malformed|invalid|expired).{0,64}(?:jwt|token)|(?:jwt|token).{0,64}(?:malformed|invalid|expired)/iu.test(
    description,
  );
};
