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
    hydrate: async () => {
      set({ isHydrating: true });
      unsubscribeAccountChanges?.();
      unsubscribeAccountChanges = window.desktopApi.account.onChanged((snapshot) => {
        set({ snapshot, errorCode: undefined });
      });
      try {
        const snapshot = await window.desktopApi.account.getSnapshot();
        set({ snapshot, isHydrating: false, errorCode: undefined });
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
