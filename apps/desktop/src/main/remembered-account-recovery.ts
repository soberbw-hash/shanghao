import type { AccountProfile, AccountRememberedLogin } from "@private-voice/shared";
import type { PersistedAccountSession } from "./account-session-store";
import { AccountDesktopError } from "./account-errors";

/** One saved-password fallback per authenticated generation, never on network errors or logout. */
export class RememberedAccountRecovery {
  private attemptedScope?: string;
  async recover(
    scope: string,
    expectedUserId: string,
    ports: {
      current(): boolean;
      read(): Promise<AccountRememberedLogin | undefined>;
      login(
        identifier: string,
        password: string,
      ): Promise<{ profile: AccountProfile; session: PersistedAccountSession }>;
    },
  ): Promise<{ profile: AccountProfile; session: PersistedAccountSession } | undefined> {
    if (this.attemptedScope === scope || !ports.current()) return;
    this.attemptedScope = scope;
    const saved = await ports.read();
    if (!saved || !ports.current()) return;
    if (saved.profile && saved.profile.userId !== expectedUserId)
      throw new AccountDesktopError("account_session_expired");
    const result = await ports.login(saved.identifier, saved.password);
    if (!ports.current() || result.profile.userId !== expectedUserId)
      throw new AccountDesktopError("account_session_expired");
    return result;
  }
}
