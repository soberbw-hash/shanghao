import type { IncomingMessage, ServerResponse } from "node:http";
import type { CloudAiAdminMutation } from "@private-voice/shared";
import { CloudAiAdminAccess } from "./cloud-ai-admin-access";
import type { CloudAiAdminStore } from "./cloud-ai-admin-store";

export class CloudAiAdminHttp {
  private pending = 0;
  private readonly rates = new Map<string, { at: number; count: number }>();
  constructor(
    private readonly access: CloudAiAdminAccess,
    private readonly store: Promise<CloudAiAdminStore>,
  ) {}
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/api/ai/admin/providers")
      return false;
    const send = (status: number, payload: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(payload));
    };
    const address = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    for (const [key, rate] of this.rates) if (now - rate.at > 60_000) this.rates.delete(key);
    const rate = this.rates.get(address) ?? { at: now, count: 0 };
    if (
      this.pending >= 2 ||
      rate.count >= 30 ||
      (!this.rates.has(address) && this.rates.size >= 1024)
    ) {
      send(429, { error: { code: "cloud_ai_admin_busy" } });
      return true;
    }
    rate.count++;
    this.rates.set(address, rate);
    this.pending++;
    try {
      if (!(await this.access.allows(req))) {
        send(403, { error: { code: "cloud_ai_admin_forbidden" } });
        return true;
      }
      const store = await this.store;
      if (req.method === "GET") {
        send(200, store.snapshot());
        return true;
      }
      if (req.method !== "POST") {
        send(405, { error: { code: "cloud_ai_admin_method_not_allowed" } });
        return true;
      }
      if (
        req.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json" ||
        Number(req.headers["content-length"]) > 32_768
      )
        throw Error("cloud_ai_admin_invalid_input");
      const chunks: Buffer[] = [];
      let bytes = 0;
      const timer = setTimeout(() => req.destroy(), 5000);
      timer.unref();
      try {
        for await (const data of req) {
          const chunk = Buffer.from(data);
          bytes += chunk.length;
          if (bytes > 32_768) throw Error("cloud_ai_admin_invalid_input");
          chunks.push(chunk);
        }
      } finally {
        clearTimeout(timer);
      }
      let mutation: CloudAiAdminMutation;
      try {
        mutation = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw Error("cloud_ai_admin_invalid_input");
      }
      send(200, await store.mutate(mutation));
    } catch (error) {
      const code =
        error instanceof Error && /^cloud_ai_admin_[a-z_]{1,60}$/.test(error.message)
          ? error.message
          : "cloud_ai_admin_unavailable";
      send(
        code === "cloud_ai_admin_conflict"
          ? 409
          : code.includes("storage") || code === "cloud_ai_admin_unavailable"
            ? 503
            : 400,
        { error: { code } },
      );
    } finally {
      this.pending--;
    }
    return true;
  }
}
