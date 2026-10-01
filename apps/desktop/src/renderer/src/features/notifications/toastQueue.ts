import type { ToastMessage } from "../../store/appStore";

/** Explicit keys group changing status copy; unrelated notices retain distinct cards. */
export const enqueueToast = (
  current: ToastMessage[],
  toast: Omit<ToastMessage, "id">,
  newId: string,
): ToastMessage[] => {
  const tone = toast.tone ?? "neutral";
  const duplicate = current.find(
    (item) =>
      (toast.dedupeKey
        ? item.dedupeKey === toast.dedupeKey
        : !item.dedupeKey &&
          item.title === toast.title &&
          item.description === toast.description) &&
      (item.tone ?? "neutral") === tone &&
      item.actionLabel === toast.actionLabel &&
      item.onAction === toast.onAction &&
      Boolean(item.persistent) === Boolean(toast.persistent),
  );
  return [
    ...current.filter((item) => item.id !== duplicate?.id),
    {
      ...toast,
      id: duplicate?.id ?? newId,
      tone,
      repeatCount: duplicate ? (duplicate.repeatCount ?? 1) + 1 : 1,
    },
  ].slice(-3);
};

export const toastStackDepth = (toasts: ToastMessage[]): number =>
  Math.min(
    3,
    toasts.reduce((count, toast) => count + (toast.repeatCount ?? 1), 0),
  );
