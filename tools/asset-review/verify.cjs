const { app, BrowserWindow, dialog, clipboard } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const profile = mkdtempSync(path.join(os.tmpdir(), "shanghao-studio-verify-"));
const root = path.join(os.homedir(), "Desktop", "上号素材审核");
const entryPackage = JSON.parse(
  require("node:fs").readFileSync(path.join(root, "package.json"), "utf8"),
);
assert.equal(entryPackage.main, "launch.cjs");
const entrySource = require("node:fs").readFileSync(path.join(root, entryPackage.main), "utf8");
let launches = 0;
require("node:vm").runInNewContext(entrySource, {
  require: (name) => {
    assert.equal(name, "./desktop.cjs");
    return { startStudio: () => launches++ };
  },
});
assert.equal(launches, 1, "desktop entry must start without require.main equality");
let output;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [output] });
let copied = 0;
clipboard.writeImage = (image) => {
  assert.equal(image.isEmpty(), false);
  copied++;
};
clipboard.writeText = () => {};
const deadline = setTimeout(() => app.exit(1), 40000);
require("./desktop.cjs").startStudio({ root, profile, show: false });
const delay = () => new Promise((resolve) => setTimeout(resolve, 25));
const waitFor = async (check) => {
  for (let i = 0; i < 600; i++) {
    if (await check()) return;
    await delay();
  }
  throw Error("Studio condition timed out");
};
app
  .whenReady()
  .then(async () => {
    await waitFor(() => BrowserWindow.getAllWindows().length);
    const window = BrowserWindow.getAllWindows()[0];
    await waitFor(
      () => !window.webContents.isLoading() && window.webContents.getURL().endsWith("index.html"),
    );
    const run = (code) => window.webContents.executeJavaScript(code);
    await waitFor(() => run("!!document.querySelector('.review-grid')"));
    await run("document.fonts.ready");
    const dimensions = await run(
      "({height:innerHeight,total:document.scrollingElement.scrollHeight,overflow:getComputedStyle(document.body).overflowY})",
    );
    assert.ok(dimensions.total > dimensions.height);
    assert.equal(dimensions.overflow, "auto");
    const notes = {
      "widget-clock": {
        name: "时钟",
        path: "fixture",
        status: "需要修改",
        comment: "隔离测试意见",
        updatedAt: "2026-10-03T00:00:00Z",
      },
    };
    await run(`window.assetStudio.saveNotes(${JSON.stringify(notes)})`);
    assert.deepEqual(await run("window.assetStudio.readNotes()"), notes);
    await window.reload();
    await waitFor(() => !window.webContents.isLoading());
    await waitFor(() => run("document.body.textContent.includes('导出意见（1）')"));
    output = path.join(profile, "export.json");
    assert.equal(await run(`window.assetStudio.exportNotes(${JSON.stringify(notes)})`), true);
    assert.deepEqual(await run("window.assetStudio.importNotes()"), notes);
    await assert.rejects(run(`window.assetStudio.exportNotes(${JSON.stringify(notes)})`), /已存在/);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json")));
    const asset = manifest.assets.find(
      (item) => item.relative.startsWith("games/screens/") && item.relative.endsWith(".jpg"),
    );
    output = path.join(profile, "asset.jpg");
    assert.equal(
      await run(`window.assetStudio.downloadAsset(${JSON.stringify(asset.relative)})`),
      true,
    );
    assert.deepEqual(
      await fs.readFile(output),
      await fs.readFile(path.join(root, "assets", asset.relative)),
    );
    await assert.rejects(run("window.assetStudio.downloadAsset('../desktop.cjs')"), /找不到素材/);
    await assert.rejects(run("window.assetStudio.copyPng('bad')"), /格式不支持/);
    await assert.rejects(
      run("window.assetStudio.capture({x:-1,y:0,width:10,height:10},'copy','test')"),
      /完整显示/,
    );
    assert.equal(
      await run("window.assetStudio.capture({x:0,y:0,width:120,height:120},'copy','test')"),
      true,
    );
    assert.equal(copied, 1);
    await fs.writeFile(path.join(profile, "reviews.json"), "damaged-fixture");
    await assert.rejects(run("window.assetStudio.readNotes()"), /原文件已保留/);
    await run(`window.assetStudio.saveNotes(${JSON.stringify(notes)})`);
    assert.equal(
      await fs.readFile(path.join(profile, "reviews.json.unreadable"), "utf8"),
      "damaged-fixture",
    );
    assert.deepEqual(await run("window.assetStudio.readNotes()"), notes);
    console.log(
      JSON.stringify({
        ok: true,
        checks: 17,
        dimensions,
        profile,
        assets: manifest.assets.length,
        games: manifest.games.length,
      }),
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(deadline);
    app.exit(process.exitCode || 0);
  });
