import assert from "node:assert/strict";
import test from "node:test";
import { MicrophoneAcquisitionError } from "../src/renderer/src/features/audio/microphoneError";
import { privateRoomErrorMessage } from "../src/renderer/src/features/room/privateRoomMessages";

test("private room entry preserves microphone busy guidance and original cause", () => {
  const cause = new DOMException("Device in use", "NotReadableError");
  const error = new MicrophoneAcquisitionError(cause);
  assert.equal(error.cause, cause);
  assert.match(privateRoomErrorMessage(error), /Stream Input/);
  assert.doesNotMatch(privateRoomErrorMessage(error), /无法完成房间操作/);
});

test("permission, missing, constraints and phone input remain distinct", () => {
  for (const [name, expected] of [
    ["NotAllowedError", "权限"],
    ["NotFoundError", "没有找到"],
    ["OverconstrainedError", "不支持"],
  ]) {
    assert.ok(
      privateRoomErrorMessage(new MicrophoneAcquisitionError(new DOMException("", name))).includes(
        expected!,
      ),
    );
  }
  assert.match(
    privateRoomErrorMessage(
      new MicrophoneAcquisitionError(new Error("手机麦克风尚未开始传输，请扫码并点击开始传输。")),
    ),
    /手机麦克风/,
  );
});

test("unknown capture details stay out of the toast; room server codes are unchanged", () => {
  const raw = new Error("DSP failed at C:\\private\\session with token=secret");
  assert.equal(
    privateRoomErrorMessage(new MicrophoneAcquisitionError(raw)),
    "麦克风启动失败，请检查声音设备后重试。",
  );
  assert.equal(privateRoomErrorMessage(new Error("room_full")), "房间已满，最多五人同时在线。");
  assert.equal(
    privateRoomErrorMessage(new Error("unrecognized-server-response")),
    "无法完成房间操作，请稍后重试。",
  );
});
