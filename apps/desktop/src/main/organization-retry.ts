import type { OrganizationRetryState } from "@private-voice/shared";

export const MAX_ORGANIZATION_LIFETIME_ATTEMPTS = 6;
export const MAX_ORGANIZATION_ATTEMPTS_PER_RUN = 2;
export const organizationExhausted = (state: OrganizationRetryState) =>
  state.status === "unrecoverable" || state.attempts >= MAX_ORGANIZATION_LIFETIME_ATTEMPTS;

export const resetOrganizationRetry = <T extends OrganizationRetryState>(state: T): T =>
  organizationExhausted(state) && state.status !== "completed"
    ? { ...state, attempts: 0, status: "pending", errorMessage: undefined }
    : state;

/** Save before inference, so a crash/restart cannot erase a consumed attempt. */
export async function runOrganizationWithRetry<T>(
  initial: OrganizationRetryState | undefined,
  save: (state: OrganizationRetryState) => Promise<void>,
  execute: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let state = initial ?? { attempts: 0, status: "pending" };
  if (state.status === "completed" && state.value !== undefined) return state.value as T;
  for (let index = 0; index < MAX_ORGANIZATION_ATTEMPTS_PER_RUN; index++) {
    if (signal.aborted) throw new Error("ai_task_paused");
    if (organizationExhausted(state)) {
      await save({ ...state, status: "unrecoverable" });
      throw new Error("organization_retry_exhausted");
    }
    state = { ...state, attempts: state.attempts + 1, status: "running" };
    await save(state);
    try {
      const result = await execute();
      await save({ ...state, status: "completed", errorMessage: undefined, value: result });
      return result;
    } catch (error) {
      state = {
        ...state,
        status: organizationExhausted(state) ? "unrecoverable" : "failed",
        errorMessage: String(error),
      };
      await save(state);
      if (signal.aborted || index + 1 === MAX_ORGANIZATION_ATTEMPTS_PER_RUN) throw error;
    }
  }
  throw new Error("organization_retry_exhausted");
}
