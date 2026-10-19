import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { NotificationDelivery } from "../src/main/notification-delivery";

class NativeNotice extends EventEmitter {
  shown = 0;
  closed = 0;
  show(): void {
    this.shown++;
  }
  close(): void {
    this.closed++;
    this.emit("close");
  }
}

test("asynchronous Windows rejection after show is reported once without message content", () => {
  const delivery = new NotificationDelivery();
  const failures: string[] = [];
  const first = new NativeNotice();
  delivery.show(
    first,
    () => undefined,
    (reason) => failures.push(reason),
  );
  first.emit("show");
  first.emit("failed", {}, "Settings prevent delivery (HRESULT: -2143420140)");
  const second = new NativeNotice();
  delivery.show(
    second,
    () => undefined,
    (reason) => failures.push(reason),
  );
  second.emit("failed", {}, "private native error");
  assert.deepEqual(failures, ["blocked"]);
});

test("pending notifications are bounded and click restores the current window", () => {
  const delivery = new NotificationDelivery();
  const notices = Array.from({ length: 5 }, () => new NativeNotice());
  let clicks = 0;
  for (const notice of notices)
    delivery.show(
      notice,
      () => clicks++,
      () => assert.fail("unexpected failure"),
    );
  assert.equal(notices[0].closed, 1);
  assert.equal(notices[4].shown, 1);
  notices[4].emit("click");
  assert.equal(clicks, 1);
});
