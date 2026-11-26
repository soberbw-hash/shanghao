import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { NotificationDelivery } from "../src/main/notification-delivery";
import {
  recordingToastXml,
  savedReplayNotice,
  transcriptNotice,
} from "../src/main/recording-notices";
import { notificationWebLink } from "../src/main/notification-web-link";
import type { VoiceMemoryRecord } from "@private-voice/shared";

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

test("room and link buttons dispatch only their own notice and only once", () => {
  const delivery = new NotificationDelivery();
  const actions: string[] = [];
  for (const id of ["first", "second"]) {
    const notice = new NativeNotice();
    delivery.show(
      notice,
      () => actions.push("body"),
      assert.fail,
      (index) => actions.push(id + index),
    );
    notice.emit("action", { actionIndex: id === "first" ? 1 : 0 });
    notice.emit("click");
  }
  assert.deepEqual(actions, ["first1", "second0"]);
});

test("recording notices use saved metadata and keep private paths out of native XML", () => {
  const clip = savedReplayNotice({
    id: "clip-2",
    durationMs: 7300,
    title: "本机",
    byteLength: 44,
    createdAt: 0,
  });
  assert.match(clip.title, /7 秒/);
  const notice = transcriptNotice({
    filePath: "private.wav",
    transcript: [{ memberId: "a" }, { memberId: "a" }, { memberId: "b" }],
    transcriptionStats: { audioDurationMs: 67000 },
  } as VoiceMemoryRecord);
  assert.match(notice.body, /1 分 7 秒.*2 位.*3 段/);
  const xml = recordingToastXml(notice, "file:///image&art.jpg", "id<1");
  assert.doesNotMatch(xml, /private.wav/);
  assert.match(xml, /image&amp;art.jpg/);
  assert.match(xml, /查看文字稿/);
  assert.match(xml, /tag=id&lt;1/);
});

test("notification link actions allow only HTTP(S) without embedded credentials", () => {
  assert.equal(
    notificationWebLink("https://example.org/music?x=1"),
    "https://example.org/music?x=1",
  );
  for (const value of [
    "file:///C:/test",
    "javascript:test",
    "https://u:p@example.org",
    "broken",
    undefined,
  ])
    assert.equal(notificationWebLink(value), undefined);
});

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
