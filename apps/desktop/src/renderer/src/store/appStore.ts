import { create } from "zustand";

export type AppPage = "home" | "room" | "settings";
export type RoomActionState = "idle" | "starting" | "joining";
export type ToastTone = "neutral" | "success" | "warning" | "danger";
export type BootstrapPhase = "booting" | "recovery" | "ready";

interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
}

export interface StartupIssue {
  title: string;
  description: string;
  details?: string[];
}

interface AppStoreState {
  currentPage: AppPage;
  isOnboardingOpen: boolean;
  isRecordingSaveDialogOpen: boolean;
  roomAction: RoomActionState;
  toasts: ToastMessage[];
  bootstrapPhase: BootstrapPhase;
  bootstrapAttempt: number;
  bootstrapMessage: string;
  startupIssue?: StartupIssue;
  isSafeMode: boolean;
  navigate: (page: AppPage) => void;
  setOnboardingOpen: (isOpen: boolean) => void;
  setRecordingSaveDialogOpen: (isOpen: boolean) => void;
  setRoomAction: (roomAction: RoomActionState) => void;
  beginBootstrap: (message?: string) => void;
  completeBootstrap: () => void;
  enterSafeMode: (issue: StartupIssue) => void;
  showStartupRecovery: (issue: StartupIssue) => void;
  dismissStartupIssue: () => void;
  retryBootstrap: () => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  currentPage: "home",
  isOnboardingOpen: false,
  isRecordingSaveDialogOpen: false,
  roomAction: "idle",
  toasts: [],
  bootstrapPhase: "booting",
  bootstrapAttempt: 0,
  bootstrapMessage: "正在准备上号…",
  startupIssue: undefined,
  isSafeMode: false,
  navigate: (page) => set({ currentPage: page }),
  setOnboardingOpen: (isOnboardingOpen) => set({ isOnboardingOpen }),
  setRecordingSaveDialogOpen: (isRecordingSaveDialogOpen) => set({ isRecordingSaveDialogOpen }),
  setRoomAction: (roomAction) => set({ roomAction }),
  beginBootstrap: (message = "正在准备上号…") =>
    set((state) => ({
      bootstrapPhase: "booting",
      bootstrapMessage: message,
      startupIssue: state.isSafeMode ? state.startupIssue : undefined,
    })),
  completeBootstrap: () =>
    set({
      bootstrapPhase: "ready",
      bootstrapMessage: "准备完成",
    }),
  enterSafeMode: (issue) =>
    set({
      bootstrapPhase: "ready",
      bootstrapMessage: "已进入安全模式",
      startupIssue: issue,
      isSafeMode: true,
    }),
  showStartupRecovery: (issue) =>
    set({
      bootstrapPhase: "recovery",
      bootstrapMessage: "启动遇到问题",
      startupIssue: issue,
      isSafeMode: true,
    }),
  dismissStartupIssue: () => set({ startupIssue: undefined }),
  retryBootstrap: () =>
    set((state) => ({
      bootstrapPhase: "booting",
      bootstrapAttempt: state.bootstrapAttempt + 1,
      bootstrapMessage: "正在重新加载…",
      startupIssue: undefined,
      isSafeMode: false,
    })),
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
    }, 3600);
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));
