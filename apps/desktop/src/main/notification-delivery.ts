import type { EventEmitter } from "node:events";

export type NotificationFailureReason = "blocked" | "failed";
type NativeNotification = Pick<EventEmitter, "once"> & { show(): void; close(): void };

/** Own native notices until completion; Windows may reject after emitting show. */
export class NotificationDelivery {
  private readonly pending = new Set<NativeNotification>();
  private reportedFailure = false;

  closeAll(): void {
    for (const notice of this.pending) notice.close();
    this.pending.clear();
  }

  show(
    notice: NativeNotification,
    onClick: () => void,
    onFailure: (reason: NotificationFailureReason) => void,
    onAction?: (index: number) => void,
  ): void {
    const failed = (error: unknown) => {
      this.pending.delete(notice);
      if (this.reportedFailure) return;
      this.reportedFailure = true;
      const text = String(error);
      onFailure(/2143420140|803e0114|settings prevent/i.test(text) ? "blocked" : "failed");
    };
    this.pending.add(notice);
    let activated = false;
    const activate = (callback: () => void) => {
      if (activated) return;
      activated = true;
      this.pending.delete(notice);
      callback();
    };
    notice.once("click", () => activate(onClick));
    notice.once("action", (event: { actionIndex?: number }, index: number) => {
      activate(() => (onAction ? onAction(event.actionIndex ?? index) : onClick()));
    });
    notice.once("close", () => this.pending.delete(notice));
    notice.once("failed", (_event, error: unknown) => failed(error));
    while (this.pending.size > 4) {
      const oldest = this.pending.values().next().value!;
      this.pending.delete(oldest);
      oldest.close();
    }
    try {
      notice.show();
    } catch (error) {
      failed(error);
    }
  }
}

export const systemNotificationDelivery = new NotificationDelivery();
