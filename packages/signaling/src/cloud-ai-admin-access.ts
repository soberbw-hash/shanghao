import type { IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
/** Admin access depends on a separately provisioned key, never an account role. */
export class CloudAiAdminAccess {
  constructor(private readonly secure: (request: IncomingMessage) => boolean) {}

  async allows(request: IncomingMessage): Promise<boolean> {
    if (!this.secure(request)) return false;
    const configuredHash = process.env.CLOUD_AI_ADMIN_KEY_SHA256 ?? "";
    if (!/^[0-9a-f]{64}$/.test(configuredHash)) return false;
    const supplied = request.headers["x-shanghao-admin-key"];
    if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
    const actual = createHash("sha256").update(supplied, "utf8").digest();
    return timingSafeEqual(actual, Buffer.from(configuredHash, "hex"));
  }
}
