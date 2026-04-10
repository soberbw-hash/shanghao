import { create } from "zustand";

export type AppPage = "home" | "room" | "settings";

interface ToastMessage {
  id: string;
  title: string;
  description?: string;
}

interface AppStoreState {
  currentPage: AppPage;
  isOnboardingOpen: boolean;
  isRecordingSaveDialogOpen: boolean;
  toasts: ToastMessage[];
  navigate: (page: AppPage) => void;
  setOnboardingOpen: (isOpen: boolean) => void;
  setRecordingSaveDialogOpen: (isOpen: boolean) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppStoreState>((set) => ({
  currentPage: "home",
  isOnboardingOpen: true,
  isRecordingSaveDialogOpen: false,
  toasts: [],
  navigate: (page) => set({ currentPage: page }),
  setOnboardingOpen: (isOnboardingOpen) => set({ isOnboardingOpen }),
  setRecordingSaveDialogOpen: (isRecordingSaveDialogOpen) =>
    set({ isRecordingSaveDialogOpen }),
  pushToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { id: crypto.randomUUID(), title: toast.title, description: toast.description },
      ],
    })),
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));
