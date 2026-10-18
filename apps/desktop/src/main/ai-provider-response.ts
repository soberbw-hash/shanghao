/** Bound streamed provider responses before allocating the complete payload. */
export const readAiProviderResponse = async (
  response: Response,
  maximum: number,
  code: string,
): Promise<string> => {
  if (Number(response.headers.get("content-length") ?? 0) > maximum) throw new Error(code);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      bytes += value.byteLength;
      if (bytes > maximum) {
        await reader.cancel(code);
        throw new Error(code);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
};
