import assert from "node:assert/strict";
import test from "node:test";
import type { DesktopCapturerSource } from "electron";
import { ScreenCaptureService } from "../src/main/screen-capture-service";

test("capture retries resolve fresh native handles and refuse an expired selected source without choosing another window", async () => {
  let calls = 0;
  const first = { id: "window:123:0", name: "selected before redraw" } as DesktopCapturerSource;
  const refreshed = { ...first, name: "fresh handle" } as DesktopCapturerSource;
  let available = [first];
  const capture = new ScreenCaptureService(undefined, async (options) => {
    calls++;
    assert.deepEqual(options.thumbnailSize, { width: 0, height: 0 });
    return available;
  });
  assert.equal(await capture.resolveRequestedSource(first.id), first);
  available = [refreshed];
  assert.equal(await capture.resolveRequestedSource(first.id), refreshed);
  available = [{ id: "window:456:0", name: "unrelated window" } as DesktopCapturerSource];
  assert.equal(await capture.resolveRequestedSource(first.id), undefined);
  assert.equal(calls, 3);
});
