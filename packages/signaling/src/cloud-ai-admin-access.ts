import type { IncomingMessage } from "node:http";
import type { AccountBackend } from "./account-service";

/** Authentication and server-owned authorization must both succeed for every admin operation. */
export class CloudAiAdminAccess {
  private readonly administratorIds: Set<string>;

  constructor(
    private readonly accounts: AccountBackend,
    private readonly secure: (request: IncomingMessage) => boolean,
    administratorIds = process.env.CLOUD_AI_ADMIN_USER_IDS ?? "",
  ) {
    this.administratorIds = new Set(
      administratorIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  async allows(request: IncomingMessage): Promise<boolean> {
    if (!this.secure(request) || !this.accounts.configured || this.administratorIds.size === 0)
      return false;
    const token = /^Bearer ([^\s]{1,8192})$/i.exec(request.headers.authorization ?? "")?.[1];
    if (!token) return false;
    try {
      const identity = await this.accounts.verifyAccessToken(token);
      return this.administratorIds.has(identity.userId);
    } catch {
      return false;
    }
  }
}
