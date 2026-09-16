/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console */
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout } = require("node:timers");
let server;
let window;
let failed = false;
app.on("window-all-closed", () => {});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(source) {
  return window.webContents.executeJavaScript(source);
}
app
  .whenReady()
  .then(async () => {
    const { createServer } = await import("vite");
    const { default: react } = await import("@vitejs/plugin-react-swc");
    server = await createServer({
      configFile: false,
      root: path.join(__dirname, ".."),
      plugins: [react()],
      optimizeDeps: { entries: ["tests/fixtures/transcript-virtualization.html"] },
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    window = new BrowserWindow({
      show: false,
      width: 800,
      height: 700,
      webPreferences: { backgroundThrottling: false },
    });
    window.webContents.on("console-message", (_event, details) => console.log(details.message));
    await window.loadURL(
      `${server.resolvedUrls.local[0]}tests/fixtures/transcript-virtualization.html`,
    );
    for (let i = 0; i < 100; i++) {
      if (await evaluate('document.querySelectorAll(".transcript-paragraph").length > 0')) break;
      await wait(100);
    }
    const rows = await evaluate('document.querySelectorAll(".transcript-paragraph").length');
    assert.ok(rows > 0 && rows < 100, `2000 paragraphs mounted ${rows} rows`);
    await evaluate('document.querySelector(".transcript-paragraph").click()');
    assert.equal(await evaluate('document.querySelector("#seek").textContent'), "0");
    await evaluate('document.querySelector(".transcript-paragraph").focus()');
    for (let i = 0; i < 20; i++) {
      await evaluate(
        'document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Tab", bubbles:true, cancelable:true}))',
      );
      for (let poll = 0; poll < 50; poll++) {
        if ((await evaluate("document.activeElement.dataset.paragraphId")) === `segment-${i + 1}`)
          break;
        await wait(50);
      }
      assert.equal(
        await evaluate("document.activeElement.dataset.paragraphId"),
        `segment-${i + 1}`,
      );
    }
    assert.equal(await evaluate("document.activeElement.dataset.paragraphId"), "segment-20");
    await evaluate('document.querySelector("#scroll").scrollTop = 10000');
    for (let i = 0; i < 50; i++) {
      if (
        await evaluate(
          'document.querySelector(".transcript-paragraph")?.dataset.paragraphId !== "segment-0"',
        )
      )
        break;
      await wait(100);
    }
    console.log(
      await evaluate(
        'JSON.stringify({top:document.querySelector("#scroll").scrollTop,height:document.querySelector("#scroll").scrollHeight,rows:document.querySelectorAll(".transcript-paragraph").length})',
      ),
    );
    const scrolled = await evaluate(
      'document.querySelector(".transcript-paragraph").dataset.paragraphId',
    );
    assert.notEqual(scrolled, "segment-0");
    await evaluate('document.querySelector("#empty").click()');
    await wait(100);
    assert.equal(await evaluate('document.querySelectorAll(".transcript-paragraph").length'), 0);
    await evaluate(
      'document.querySelector("#small").click(); document.querySelector("#scroll").scrollTop = 0',
    );
    await wait(300);
    assert.equal(await evaluate('document.querySelectorAll(".transcript-paragraph").length'), 2);
    console.log(
      JSON.stringify({
        success: true,
        totalParagraphs: 2000,
        initialMountedRows: rows,
        scrolledFirstRow: scrolled,
        seek: "passed",
        empty: "passed",
        small: "passed",
      }),
    );
  })
  .catch((error) => {
    console.error(error);
    failed = true;
  })
  .finally(async () => {
    window?.destroy();
    await server?.close();
    app.exit(failed ? 1 : 0);
  });
