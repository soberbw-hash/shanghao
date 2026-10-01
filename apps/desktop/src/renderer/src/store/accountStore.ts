import { create } from "zustand";

import type {
  AccountAvatarUpdateRequest,
  AccountLoginRequest,
  AccountPasswordResetRequest,
  AccountProfileUpdateRequest,
  AccountRegisterRequest,
  AccountSnapshot,
} from "@private-voice/shared";

import { accountErrorCode } from "../features/account/accountMessages";

interface AccountStoreState {
  snapshot: AccountSnapshot;
  isHydrating: boolean;
  isBusy: boolean;
  errorCode?: string;
  hydrate: () => Promise<AccountSnapshot>;
  login: (request: AccountLoginRequest) => Promise<AccountSnapshot>;
  register: (request: AccountRegisterRequest) => Promise<AccountSnapshot>;
  requestVerificationCode: (phone: string) => Promise<void>;
  requestPasswordReset: (request: AccountPasswordResetRequest) => Promise<void>;
  updateProfile: (request: AccountProfileUpdateRequest) => Promise<AccountSnapshot>;
  updateAvatar: (request: AccountAvatarUpdateRequest) => Promise<AccountSnapshot>;
  logout: () => Promise<AccountSnapshot>;
  continueAsGuest: () => Promise<AccountSnapshot>;
  clearError: () => void;
}

const initialSnapshot: AccountSnapshot = {
  status: "loading",
  configured: false,
  guestAllowed: false,
};

let unsubscribeAccountChanges: (() => void) | undefined;
let hydration: Promise<AccountSnapshot> | undefined;

export const useAccountStore = create<AccountStoreState>((set) => {
  const run = async <T extends AccountSnapshot>(task: () => Promise<T>): Promise<T> => {
    set({ isBusy: true, errorCode: undefined });
    try {
      const snapshot = await task();
      set({ snapshot, isBusy: false, errorCode: undefined });
      return snapshot;
    } catch (error) {
      set({ isBusy: false, errorCode: accountErrorCode(error) });
      throw error;
    }
  };

  return {
    snapshot: initialSnapshot,
    isHydrating: true,
    isBusy: false,
    errorCode: undefined,
    hydrate: () => {
      if (hydration) return hydration;
      hydration = (async () => {
        set({ isHydrating: true });
        unsubscribeAccountChanges?.();
        unsubscribeAccountChanges = window.desktopApi.account.onChanged((snapshot) => {
          set({ snapshot, errorCode: undefined });
        });
        try {
          let snapshot = await window.desktopApi.account.getSnapshot();
          // One fallback per startup, only after session recovery has definitively failed.
          // A network outage must not trigger password retries or erase saved credentials.
          if (
            snapshot.status === "signed_out" &&
            snapshot.configured &&
            (!snapshot.message || snapshot.message === "account_session_expired")
          ) {
            const remembered = await window.desktopApi.account
              .getRememberedLogin()
              .catch(() => undefined);
            if (remembered) {
              try {
                snapshot = await window.desktopApi.account.login({
                  identifier: remembered.identifier,
                  password: remembered.password,
                  rememberMe: true,
                });
              } catch (error) {
                const latest = await window.desktopApi.account.getSnapshot().catch(() => snapshot);
                snapshot =
                  latest.status === "signed_in"
                    ? latest
                    : { ...latest, message: accountErrorCode(error) };
              }
            }
          }
          set({ snapshot, isHydrating: false, errorCode: snapshot.message });
          return snapshot;
        } catch (error) {
          const errorCode = accountErrorCode(error);
          const snapshot: AccountSnapshot = {
            status: "unavailable",
            configured: false,
            guestAllowed: false,
            message: errorCode,
          };
          set({ snapshot, isHydrating: false, errorCode });
          return snapshot;
        }
      })().finally(() => {
        hydration = undefined;
      });
      return hydration;
    },
    login: (request) => run(() => window.desktopApi.account.login(request)),
    register: (request) => run(() => window.desktopApi.account.register(request)),
    requestVerificationCode: async (phone) => {
      set({ isBusy: true, errorCode: undefined });
      try {
        await window.desktopApi.account.requestVerificationCode(phone);
        set({ isBusy: false });
      } catch (error) {
        set({ isBusy: false, errorCode: accountErrorCode(error) });
        throw error;
      }
    },
    requestPasswordReset: async (request) => {
      set({ isBusy: true, errorCode: undefined });
      try {
        await window.desktopApi.account.requestPasswordReset(request);
        set({ isBusy: false });
      } catch (error) {
        set({ isBusy: false, errorCode: accountErrorCode(error) });
        throw error;
      }
    },
    updateProfile: (request) => run(() => window.desktopApi.account.updateProfile(request)),
    updateAvatar: (request) => run(() => window.desktopApi.account.updateAvatar(request)),
    logout: () => run(() => window.desktopApi.account.logout()),
    continueAsGuest: () => run(() => window.desktopApi.account.continueAsGuest()),
    clearError: () => set({ errorCode: undefined }),
  };
});
