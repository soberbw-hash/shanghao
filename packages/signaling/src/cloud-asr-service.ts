const PROVIDER = "https://api.siliconflow.cn/v1/audio/transcriptions";
export const CLOUD_ASR_MODEL = "FunAudioLLM/SenseVoiceSmall";
export const CLOUD_ASR_MAX_BYTES = 12 * 1024 * 1024;

/** Fixed server-funded provider. No caller URL, model, filename or credentials. */
export class CloudAsrService {
  constructor(
    private readonly key = process.env.SILICONFLOW_API_KEY?.trim() ?? "",
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  isConfigured(): boolean {
    return Boolean(this.key);
  }
  async transcribe(
    audio: Buffer,
    mime: string,
    signal: AbortSignal,
  ): Promise<{ text: string; modelName: string }> {
    if (!this.key) throw Error("cloud_asr_not_configured");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), "audio-chunk");
    form.append("model", CLOUD_ASR_MODEL);
    const response = await this.fetcher(PROVIDER, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${this.key}` },
      body: form,
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw Error(`cloud_asr_http_${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > 256 * 1024) {
      await response.body?.cancel().catch(() => undefined);
      throw Error("cloud_asr_response_too_large");
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error("cloud_asr_invalid_response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 256 * 1024) {
          await reader.cancel();
          throw Error("cloud_asr_response_too_large");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    let payload: { text?: unknown };
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Error("cloud_asr_invalid_response");
    }
    if (!payload || typeof payload.text !== "string") throw Error("cloud_asr_invalid_response");
    signal.throwIfAborted();
    return { text: payload.text, modelName: CLOUD_ASR_MODEL };
  }
}
