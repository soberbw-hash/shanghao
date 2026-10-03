const { app, BrowserWindow, dialog, clipboard } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "shanghao-studio-verify-"));
const testEntry = process.env.ASSET_STUDIO_TEST_ENTRY === "1";
const profile = testEntry ? path.join(isolatedRoot, "ShangHaoAssetStudio") : isolatedRoot;
const root =
  process.env.ASSET_STUDIO_TEST_ROOT || path.join(os.homedir(), "Desktop", "上号素材审核");
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
dialog.showErrorBox = (title, message) => {
  console.error(title, message);
  app.exit(1);
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [output] });
let copied = 0;
clipboard.writeImage = (image) => {
  assert.equal(image.isEmpty(), false);
  copied++;
};
clipboard.writeText = () => {};
const deadline = setTimeout(() => app.exit(1), 90000);
if (testEntry) {
  console.log("Checking packaged early entry");
  const Module = require("node:module"),
    originalLoad = Module._load;
  const electron = require("electron");
  Module._load = function (request, parent, ...rest) {
    if (request === "electron" && parent.filename.endsWith("desktop.cjs"))
      return {
        ...electron,
        BrowserWindow: class extends BrowserWindow {
          constructor(options) {
            super({
              ...options,
              show: false,
              webPreferences: {
                ...options.webPreferences,
                offscreen: true,
                backgroundThrottling: false,
              },
            });
          }
        },
      };
    return originalLoad.call(this, request, parent, ...rest);
  };
  app.setPath("appData", isolatedRoot);
  app.setPath("userData", isolatedRoot);
  app.setPath("sessionData", isolatedRoot);
  Object.defineProperty(app, "isPackaged", { value: true });
  Object.defineProperty(process, "resourcesPath", { value: path.dirname(root) });
  process.argv.push("--asset-studio");
  app.on("browser-window-created", (_event, window) => window.hide());
  // Load the actual compiled early entry, using only isolated path/foreground shims.
  require(path.resolve(root, "../app.asar/dist-electron/main/index.cjs"));
  Module._load = originalLoad;
  console.log("Packaged profile:", app.getPath("userData"));
} else require(path.join(root, "desktop.cjs")).startStudio({ root, profile, show: false });
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
    console.log("Studio ready");
    await waitFor(() => BrowserWindow.getAllWindows().length);
    const window = BrowserWindow.getAllWindows()[0];
    console.log("Studio window created");
    assert.equal(app.getPath("userData"), profile);
    await waitFor(
      () => !window.webContents.isLoading() && window.webContents.getURL().endsWith("index.html"),
    );
    const run = (code) => window.webContents.executeJavaScript(code);
    await waitFor(() => run("!!document.querySelector('.review-grid')"));
    console.log("Studio renderer ready");
    if (testEntry) {
      console.log(
        JSON.stringify({
          ok: true,
          checks: 4,
          entry: "compiled app.asar",
          profile,
          isolated: true,
        }),
      );
      return;
    }
    const fonts = await run(
      "Promise.race([document.fonts.ready.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),5000))])",
    );
    assert.equal(fonts, true, "studio fonts must load within five seconds");
    // Deterministic foreground/hidden states inside this isolated renderer only.
    await run(
      "Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});window.dispatchEvent(new Event('focus'))",
    );
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
    let checks = 17;
    await run(
      "Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});window.dispatchEvent(new Event('focus'))",
    );
    const tab = async (label) => {
      await run(
        `Array.from(document.querySelectorAll('.review-tabs button')).find(x=>x.textContent===${JSON.stringify(label)}).click()`,
      );
      await delay();
    };
    const select = async (label, value) => {
      await run(
        `(()=>{const x=document.querySelector('select[aria-label="${label}"]');x.value=${JSON.stringify(value)};x.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
      await delay();
    };
    assert.equal(await run("document.querySelectorAll('.review-tabs button').length"), 7);
    checks++;
    await tab("品牌图标");
    assert.equal(await run("document.querySelectorAll('.review-card').length"), 4);
    checks++;
    await tab("天气效果");
    assert.equal(await run("document.querySelectorAll('.review-card').length"), 8);
    checks++;
    for (const phase of ["dawn", "day", "dusk", "night"]) {
      await select("天气昼夜", phase);
      const scenes = await run(
        "Array.from(document.querySelectorAll('.review-grid .dynamic-weather-window')).map(x=>({scene:Array.from(x.classList).find(c=>c.startsWith('weather-scene-')),phase:Array.from(x.classList).find(c=>c.startsWith('weather-phase-'))}))",
      );
      assert.equal(scenes.length, 8);
      for (const scene of scenes) {
        assert.equal(scene.phase, `weather-phase-${phase}`);
        checks++;
      }
      assert.equal(new Set(scenes.map((x) => x.scene)).size, 8);
      checks++;
    }
    await tab("角色动作");
    assert.equal(await run("document.querySelectorAll('[data-preview-avatar]').length"), 5);
    checks++;
    const actions = await run(
      "Array.from(document.querySelector('select[aria-label=\"角色动作\"]').options).map(x=>x.value)",
    );
    assert.equal(actions.length, 18);
    checks++;
    for (const action of actions.filter((value) => value !== "all")) {
      await select("角色动作", action);
      const results = await run(
        "Array.from(document.querySelectorAll('[data-preview-avatar]')).map(x=>({id:x.dataset.previewAvatar,children:x.querySelector('.review-character-actor').children.length}))",
      );
      for (const result of results) {
        assert.ok(result.children > 0);
        checks++;
      }
    }
    await select("角色动作", "all");
    assert.equal(
      await run("document.querySelectorAll('.review-grid [data-preview-avatar]').length"),
      85,
    );
    assert.equal(
      await run(
        "new Set(Array.from(document.querySelectorAll('.review-grid [data-preview-avatar]')).map(x=>x.dataset.previewAvatar+'-'+x.dataset.previewAction)).size",
      ),
      85,
    );
    await run(
      "Promise.all(Array.from(document.querySelectorAll('.review-grid img')).map(x=>x.decode()))",
    );
    assert.ok(
      await run(
        "Array.from(document.querySelectorAll('.review-grid .desk-animal')).every(x=>{const r=x.getBoundingClientRect();return Math.abs(r.width-r.height)<0.01})",
      ),
      "seated character container must preserve production proportions",
    );
    checks += 4;
    for (const direction of ["walk-left", "walk-right"]) {
      await select("角色动作", direction);
      await run(
        "Promise.all(Array.from(document.querySelectorAll('.review-grid img')).map(x=>x.decode()))",
      );
      const assertProportions = async (scope) => {
        const frames = await run(
          `Array.from(document.querySelectorAll('${scope} .walking-animal-run-cycle-strip')).map(x=>({actual:x.getBoundingClientRect().width/16/x.getBoundingClientRect().height,original:x.naturalWidth/16/x.naturalHeight}))`,
        );
        assert.ok(frames.length > 0);
        for (const frame of frames)
          assert.ok(
            Math.abs(frame.actual - frame.original) < 0.01,
            "walking frame must retain source proportions",
          );
        const bounds = await run(
          `Array.from(document.querySelectorAll('${scope} .walking-animal')).map(x=>{const actor=x.getBoundingClientRect(),stage=x.closest('.review-character-stage').getBoundingClientRect();return actor.left>=stage.left-1&&actor.right<=stage.right+1})`,
        );
        assert.ok(bounds.every(Boolean), "walking preview must remain fully visible");
        checks++;
      };
      await assertProportions(".review-grid");
      await run("document.querySelector('.review-preview').click()");
      await delay();
      await assertProportions("dialog");
      await run("document.querySelector('dialog').close()");
    }
    const studioIcon = await fs.readFile(path.join(root, "studio.ico"));
    const mainIcon = manifest.assets.find((x) => x.relative === "branding/shanghao-icon-v4.ico");
    const derivedIcon = manifest.assets.find((x) => x.relative === "branding/studio-icon.ico");
    assert.deepEqual(
      studioIcon,
      await fs.readFile(path.join(root, "assets", derivedIcon.relative)),
    );
    assert.notDeepEqual(
      studioIcon,
      await fs.readFile(path.join(root, "assets", mainIcon.relative)),
    );
    checks += 2;
    await select("角色动作", "walk-right");
    await run("document.querySelector('.review-controls button[aria-pressed]').click()");
    await delay();
    assert.equal(
      await run(
        "getComputedStyle(document.querySelector('.review-walk-right')).animationPlayState",
      ),
      "paused",
    );
    checks++;
    await run("document.querySelector('.review-controls button[aria-pressed]').click()");
    await delay();
    assert.equal(
      await run(
        "getComputedStyle(document.querySelector('.review-walk-right')).animationPlayState",
      ),
      "running",
    );
    checks++;
    await select("角色动作", "idle");
    await run(
      "Promise.all(Array.from(document.querySelectorAll('.review-grid img')).map(x=>x.decode()))",
    );
    checks++;
    await select("角色动作", "walk-right");
    await run(
      "Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'))",
    );
    await delay();
    assert.equal(
      await run(
        "getComputedStyle(document.querySelector('.review-walk-right')).animationPlayState",
      ),
      "paused",
    );
    checks++;
    await run(
      "Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});window.dispatchEvent(new Event('focus'))",
    );
    await delay();
    assert.equal(
      await run(
        "getComputedStyle(document.querySelector('.review-walk-right')).animationPlayState",
      ),
      "running",
    );
    checks++;
    await select("角色动作", "idle");
    if (process.env.ASSET_STUDIO_SCREENSHOTS) {
      const screenshots = path.resolve(process.env.ASSET_STUDIO_SCREENSHOTS);
      await fs.mkdir(screenshots, { recursive: true });
      await select("角色动作", "all");
      await run("window.scrollTo(0,0)");
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fs.writeFile(
        path.join(screenshots, "asset-studio.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await select("角色动作", "walk-left");
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fs.writeFile(
        path.join(screenshots, "asset-walk-left.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await tab("天气效果");
      await select("天气昼夜", "night");
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fs.writeFile(
        path.join(screenshots, "asset-weather.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await tab("角色动作");
      await select("角色动作", "idle");
    }
    window.setSize(900, 650);
    await delay();
    await run("document.querySelector('.review-preview').click()");
    await delay();
    assert.equal(await run("document.querySelector('dialog').open"), true);
    checks++;
    assert.ok(
      await run(
        "document.querySelector('dialog').scrollHeight > document.querySelector('dialog').clientHeight",
      ),
    );
    checks++;
    await run("document.querySelector('dialog').close()");
    await tab("游戏显示器");
    assert.equal(await run("document.querySelectorAll('.review-card').length"), 60);
    checks++;
    await run(
      "Promise.all(Array.from(document.querySelectorAll('.review-grid img')).map(x=>x.decode()))",
    );
    checks++;
    await tab("账号头像");
    assert.equal(await run("document.querySelectorAll('.review-card').length"), 32);
    checks++;
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
      await fs.readFile(
        asset.bundledFile
          ? path.resolve(root, "../app.asar/dist/assets", asset.bundledFile)
          : path.join(root, "assets", asset.relative),
      ),
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
        checks,
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
