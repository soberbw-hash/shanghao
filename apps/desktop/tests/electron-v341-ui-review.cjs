/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "vnext-ui-review");
const root = path.resolve(__dirname, "../../..");
process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:45739";
const nativeOutput = path.join(root, "test-artifacts/v341-native");
const syncFs = require("node:fs");
syncFs.mkdirSync(path.join(nativeOutput, "preload"), { recursive: true });
syncFs.copyFileSync(path.join(__dirname, "../dist-electron/preload/overlay.cjs"), path.join(nativeOutput, "preload/overlay.cjs"));
require(require.resolve("esbuild", { paths: [path.dirname(require.resolve("tsup"))] })).buildSync({
  entryPoints: [path.join(__dirname, "../src/main/overlay-window.ts")],
  outfile: path.join(nativeOutput, "main/overlay.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const { OverlayWindowController } = require(path.join(root, "test-artifacts/v341-native/main/overlay.cjs"));
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => app.exit(1), 40_000);
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  let reviewWindow, overlay, failed = false;
  try {
    reviewWindow = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { offscreen: true, backgroundThrottling: false } });
    reviewWindow.webContents.on("console-message", event => { if (event.level === "error") console.error(event.message); });
    const fixture = path.join(__dirname, "fixtures/v341-ui-review.html").replaceAll("\\", "/");
    await reviewWindow.loadURL(`http://127.0.0.1:45739/@fs/${fixture}`);
    const run = (code) => reviewWindow.webContents.executeJavaScript(code);
    await delay(1800);
    await run("document.fonts.ready");
    const widths = [];
    for (const width of [180, 300, 460, 640]) {
      await run(`document.querySelector('select').value='${width}';document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`);
      await delay(150);
      const seen = new Set();
      for (let page = 0; page < 10; page++) {
        const result = await run(`(() => {const row=document.querySelector('.chat-quick-music-row'), bounds=row.getBoundingClientRect();return [...row.querySelectorAll('button:not(.chat-quick-more)')].map(button=>({label:button.innerText, right:button.getBoundingClientRect().right, rowRight:bounds.right, textWidth:button.querySelector('span').scrollWidth, textClientWidth:button.querySelector('span').clientWidth, fits:button.getBoundingClientRect().right<=bounds.right+1 && button.querySelector('span').scrollWidth<=button.querySelector('span').clientWidth+1}));})()`);
        assert.ok(result.length);
        for (const item of result) { if (!item.fits) console.error(JSON.stringify(item)); assert.ok(item.fits, `${width}: ${item.label} was clipped`); seen.add(item.label); }
        await run(`document.querySelector('.chat-quick-more')?.click()`);
        await delay(25);
      }
      assert.equal(seen.size, 10);
      widths.push({ width, visibleWithoutClipping: seen.size });
    }
    await fs.writeFile(path.join(root, "test-artifacts/v341-ui-review.png"), (await reviewWindow.webContents.capturePage()).toPNG());
    const music = await run("window.review.musicStops()");
    assert.equal(music.plays, 1); assert.ok(music.pauses >= 2); assert.equal(music.status, "idle");
    const away = await run("({width:document.querySelector('.room-character-away-label').getBoundingClientRect().width,left:document.querySelector('.room-character-away-label').getBoundingClientRect().left,text:document.querySelector('.room-character-away-label').innerText})");
    assert.ok(away.width > 70 && away.left > 0); assert.ok(away.text.includes('Sober 测试') && away.text.includes('暂离'));
    await run("window.review.stale()"); await delay(500);
    assert.equal(await run("window.review.repairs()"), 0);
    await run("window.review.lose();window.review.lose();window.review.lose()"); await delay(500);
    assert.equal(await run("window.review.repairs()"), 1);
    await run("window.review.swapOwner();window.review.finish()"); await delay(2300);
    assert.equal(await run("window.review.repairs()"), 1);
    overlay = new OverlayWindowController();
    ipcMain.handle("overlay:set-interactive", (_event, value) => overlay.setInteractive(value));
    const members = Array.from({ length: 5 }, (_, i) => ({ id: `member-${i}`, nickname: `好友 ${i + 1}`, joinedAt: new Date().toISOString(), isHost: i === 0, isLocal: i === 0, isMuted: false, presenceState: "online", speakingState: "silent", volume: 1, connectionQuality: "good", avatarId: "fox" }));
    overlay.update({ members, isMuted: false, isDeafened: false, connectionState: "connected" });
    overlay.show();
    const overlayWindow = BrowserWindow.getAllWindows().find(window => window !== reviewWindow);
    await new Promise(resolve => overlayWindow.webContents.once("did-finish-load", resolve));
    await delay(1000);
    const readOverlay = () => overlayWindow.webContents.executeJavaScript(`({rows:document.querySelectorAll('[data-overlay-row]').length, width:innerWidth, height:innerHeight, scroll:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth, app:!!document.querySelector('#app-preboot-cover,.app-shell'), background:getComputedStyle(document.body).backgroundColor, marker:window.shanghaoRenderer})`);
    const five = await readOverlay();
    assert.equal(five.rows, 5); assert.equal(five.width, 142); assert.equal(five.height, 206); assert.equal(five.scroll, false); assert.equal(five.app, false); assert.equal(five.marker, "overlay");
    assert.equal(overlayWindow.isAlwaysOnTop(), true); assert.equal(overlayWindow.isFocusable(), false);
    await fs.writeFile(path.join(root, "test-artifacts/v341-overlay-five.png"), (await overlayWindow.webContents.capturePage()).toPNG());
    overlay.update({ members: members.slice(0, 1), isMuted: false, isDeafened: false, connectionState: "connected" });
    await delay(150);
    const one = await readOverlay(); assert.equal(one.rows, 1); assert.equal(one.height, 46); assert.equal(one.scroll, false);
    await fs.writeFile(path.join(root, "test-artifacts/v341-ui-review.json"), JSON.stringify({ ok: true, widths, inputRecovery: { staleIgnored: true, coalesced: true, oldOwnerCannotRetry: true }, overlay: { one, five, alwaysOnTop: true, focusable: false } }, null, 2));
    console.log("V341_UI_REVIEW_PASSED");
  } catch (error) { console.error(error); failed = true; }
  finally { clearTimeout(deadline); overlay?.close(); reviewWindow?.destroy(); if (failed) app.exit(1); else app.quit(); }
});
