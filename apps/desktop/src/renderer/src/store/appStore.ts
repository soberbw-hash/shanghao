import { create } from "zustand";

export type AppPage = "home" | "room" | "settings";
export type RoomActionState = "idle" | "starting" | "joining";
export type ToastTone = "neutral" | "success" | "warning" | "danger";

interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface AppStoreState {
  currentPage: AppPage;
  isOnboardingOpen: boolean;
  isRecordingSaveDialogOpen: boolean;
  roomAction: RoomActionState;
  toasts: ToastMessage[];
  navigate: (page: AppPage) => void;
  setOnboardingOpen: (isOpen: boolean) => void;
  setRecordingSaveDialogOpen: (isOpen: boolean) => void;
  setRoomAction: (roomAction: RoomActionState) => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  currentPage: "home",
  isOnboardingOpen: false,
  isRecordingSaveDialogOpen: false,
  roomAction: "idle",
  toasts: [],
  navigate: (page) => set({ currentPage: page }),
  setOnboardingOpen: (isOnboardingOpen) => set({ isOnboardingOpen }),
  setRecordingSaveDialogOpen: (isRecordingSaveDialogOpen) =>
    set({ isRecordingSaveDialogOpen }),
  setRoomAction: (roomAction) => set({ roomAction }),
  pushToast: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id,
          title: toast.title,
          description: toast.description,
          tone: toast.tone ?? "neutral",
        },
      ],
    }));

    window.setTimeout(() => {
      get().dismissToast(id);
    }, 4800);
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));
