import { startTransition } from "react";
import { create } from "zustand";

import { interactionPerformanceMonitor } from "../features/diagnostics/interactionPerformanceMonitor";
import { enqueueToast } from "../features/notifications/toastQueue";

export type AppPage = "home" | "room" | "settings";
export type SettingsReturnTarget = "home" | "room";
export type RoomActionState = "idle" | "starting" | "joining";
export type ToastTone = "neutral" | "success" | "warning" | "danger";
export type BootstrapPhase = "booting" | "checking-update" | "update-gate" | "recovery" | "ready";

export interface VoiceMemoryOpenTarget {
  filePath: string;
  startMs: number;
  requestId: number;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  repeatCount?: number;
  actionLabel?: string;
  onAction?: () => void;
  persistent?: boolean;
  dedupeKey?: string;
  clipFilePath?: string;
}

export interface StartupIssue {
  title: string;
  description: string;
  details?: string[];
}

interface AppStoreState {
  currentPage: AppPage;
  settingsReturnTo: SettingsReturnTarget;
  isOnboardingOpen: boolean;
  roomAction: RoomActionState;
  toasts: ToastMessage[];
  bootstrapPhase: BootstrapPhase;
  bootstrapAttempt: number;
  bootstrapMessage: string;
  startupIssue?: StartupIssue;
  requiredUpdate?: { requiredVersion: string; currentVersion: string };
  voiceMemoryOpenTarget?: VoiceMemoryOpenTarget;
  pendingRoomInvite?: string;
  pendingRoomInviteAutoJoin: boolean;
  setPendingRoomInvite: (roomId?: string, autoJoin?: boolean) => void;
  isSafeMode: boolean;
  navigate: (page: AppPage) => void;
  setSettingsReturnTo: (target: SettingsReturnTarget) => void;
  setOnboardingOpen: (isOpen: boolean) => void;
  setVoiceMemoryOpenTarget: (target?: Omit<VoiceMemoryOpenTarget, "requestId">) => void;
  setRoomAction: (roomAction: RoomActionState) => void;
  beginBootstrap: (message?: string) => void;
  completeBootstrap: () => void;
  enterSafeMode: (issue: StartupIssue) => void;
  showStartupRecovery: (issue: StartupIssue) => void;
  dismissStartupIssue: () => void;
  retryBootstrap: () => void;
  enterUpdateGate: () => void;
  requireUpdate: (requiredVersion: string, currentVersion: string) => void;
  dismissUpdateGate: () => void;
  pushToast: (toast: Omit<ToastMessage, "id">) => void;
  dismissToast: (id: string) => void;
}

const toastTimers = new Map<string, number>();
const clearToastTimer = (id: string): void => {
  const timer = toastTimers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  toastTimers.delete(id);
};

export const useAppStore = create<AppStoreState>((set, get) => ({
  currentPage: "home",
  settingsReturnTo: "home",
  isOnboardingOpen: false,
  roomAction: "idle",
  toasts: [],
  bootstrapPhase: "booting",
  bootstrapAttempt: 0,
  bootstrapMessage: "正在准备上号…",
  startupIssue: undefined,
  requiredUpdate: undefined,
  isSafeMode: false,
  navigate: (page) => {
    const current = get().currentPage;
    if (current !== page) {
      const interactionId = interactionPerformanceMonitor.begin(
        `route:${current}->${page}`,
        current,
      );
      interactionPerformanceMonitor.mark(interactionId, "visual-feedback-start");
      interactionPerformanceMonitor.mark(interactionId, "route-transition-start");
      interactionPerformanceMonitor.afterNextPaint(interactionId);
    }
    startTransition(() => set({ currentPage: page }));
  },
  setSettingsReturnTo: (settingsReturnTo) => set({ settingsReturnTo }),
  setOnboardingOpen: (isOnboardingOpen) => set({ isOnboardingOpen }),
  setVoiceMemoryOpenTarget: (target) =>
    set({
      voiceMemoryOpenTarget: target ? { ...target, requestId: Date.now() } : undefined,
    }),
  pendingRoomInviteAutoJoin: false,
  setPendingRoomInvite: (pendingRoomInvite, autoJoin = false) =>
    set({ pendingRoomInvite, pendingRoomInviteAutoJoin: Boolean(pendingRoomInvite && autoJoin) }),
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
  enterUpdateGate: () =>
    set({
      bootstrapPhase: "update-gate",
      bootstrapMessage: "正在检查更新…",
    }),
  requireUpdate: (requiredVersion, currentVersion) =>
    set({
      bootstrapPhase: "update-gate",
      bootstrapMessage: "需要更新后才能进入频道",
      requiredUpdate: { requiredVersion, currentVersion },
    }),
  dismissUpdateGate: () =>
    set({
      bootstrapPhase: "ready",
      bootstrapMessage: "准备完成",
    }),
  pushToast: (toast) => {
    let id: string = crypto.randomUUID();
    const tone = toast.tone ?? "neutral";
    set((state) => {
      const toasts = enqueueToast(state.toasts, toast, id);
      id = toasts.at(-1)!.id;
      for (const previous of state.toasts) {
        if (!toasts.some((item) => item.id === previous.id)) clearToastTimer(previous.id);
      }
      return { toasts };
    });
    clearToastTimer(id);
    if (!toast.persistent) {
      const duration =
        tone === "success"
          ? 2_800
          : tone === "neutral"
            ? 4_200
            : tone === "warning"
              ? 8_000
              : 12_000;
      const timer = window.setTimeout(() => {
        toastTimers.delete(id);
        get().dismissToast(id);
      }, duration);
      toastTimers.set(id, timer);
    }
  },
  dismissToast: (id) => {
    clearToastTimer(id);
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
}));
