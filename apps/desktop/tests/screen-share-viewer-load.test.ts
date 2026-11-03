import assert from "node:assert/strict";
import test from "node:test";
import { loadScreenShareViewer } from "../src/main/screen-share-viewer-load";

test("detached viewer only appears for the current live session and a failed load leaves no hidden window", async () => {
  const bounds = { x: 0, y: 0, width: 900, height: 600 };
  for (const scenario of ["current", "closed", "superseded", "failure", "old-failure"]) {
    let destroyed = false,
      shown = 0,
      focused = 0,
      resized = 0,
      released = 0;
    let current = true;
    let finish!: () => void, fail!: (error: Error) => void;
    const loading = new Promise<void>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const viewer = {
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
      },
      show: () => {
        shown++;
      },
      focus: () => {
        focused++;
      },
      setBounds: () => {
        resized++;
      },
    };
    const pending = loadScreenShareViewer(
      viewer,
      () => loading,
      () => current,
      () => {
        released++;
      },
      bounds,
    );
    if (scenario === "closed") destroyed = true;
    if (scenario === "superseded" || scenario === "old-failure") current = false;
    if (scenario.includes("failure")) {
      const rejection = assert.rejects(pending, /synthetic-load-failure/);
      fail(Error("synthetic-load-failure"));
      await rejection;
    } else {
      finish();
      await pending;
    }
    assert.equal(shown, scenario === "current" ? 1 : 0, scenario);
    assert.equal(focused, shown);
    assert.equal(resized, shown);
    assert.equal(
      released,
      scenario === "failure" ? 1 : 0,
      "old failures must not release a new session",
    );
    assert.equal(destroyed, scenario !== "current", scenario);
  }
});
