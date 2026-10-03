const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } = require("electron");
const fs = require("node:fs/promises");
const { mkdirSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
function startStudio({
  root = __dirname,
  profile = path.join(app.getPath("appData"), "ShangHaoAssetStudio"),
  show = true,
} = {}) {
  // Electron requires overridden paths to exist before the first session starts.
  mkdirSync(path.join(profile, "session"), { recursive: true });
  app.setName("上号素材");
  app.setPath("userData", profile);
  app.setPath("sessionData", path.join(profile, "session"));
  app.setAppUserModelId("ShangHao.AssetStudio");
  const entry = pathToFileURL(path.join(root, "index.html")).href;
  const quitForInstall = process.argv.includes("--shanghao-quit-for-install");
  let window;
  if (!app.requestSingleInstanceLock()) app.quit();
  else if (quitForInstall) app.quit();
  else {
    app.on("second-instance", (_event, argv) => {
      if (argv.includes("--shanghao-quit-for-install")) {
        app.quit();
        return;
      }
      if (window) {
        window.restore();
        window.show();
        window.focus();
      }
    });
    app
      .whenReady()
      .then(async () => {
        const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
        const assets = new Map(manifest.assets.map((asset) => [asset.relative, asset]));
        const notePath = path.join(app.getPath("userData"), "reviews.json");
        const noteLimit = 5 * 1024 * 1024;
        const readNoteFile = async () => {
          if ((await fs.stat(notePath)).size > noteLimit) throw Error("审核文件过大");
          return fs.readFile(notePath, "utf8");
        };
        const validateNotes = (value) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw Error("审核文件格式不正确");
          if (Object.keys(value).length > 5000) throw Error("审核记录过多");
          const result = {};
          for (const [id, note] of Object.entries(value)) {
            if (!/^(asset-|game-|widget-|legacy-)/.test(id) || !note || typeof note !== "object")
              throw Error("审核记录格式不正确");
            if (
              !["待审核", "通过", "需要修改"].includes(note.status) ||
              typeof note.comment !== "string" ||
              note.comment.length > 20000
            )
              throw Error("审核记录内容不正确");
            result[id] = {
              name: String(note.name || "").slice(0, 300),
              path: String(note.path || "").slice(0, 1000),
              status: note.status,
              comment: note.comment,
              updatedAt: String(note.updatedAt || ""),
            };
          }
          return result;
        };
        let writes = Promise.resolve();
        const writeNotes = (value) => {
          const data = JSON.stringify(validateNotes(value), null, 2);
          if (Buffer.byteLength(data) > noteLimit) throw Error("审核文件过大");
          const run = writes
            .catch(() => {})
            .then(async () => {
              await fs.mkdir(path.dirname(notePath), { recursive: true });
              try {
                const previous = await readNoteFile();
                try {
                  validateNotes(JSON.parse(previous));
                  await fs.copyFile(notePath, notePath + ".backup");
                } catch (error) {
                  if (error.code) throw error;
                  await fs.copyFile(
                    notePath,
                    notePath + ".unreadable",
                    require("node:fs").constants.COPYFILE_EXCL,
                  );
                }
              } catch (e) {
                if (e.code !== "ENOENT") throw e;
              }
              const temp = notePath + ".tmp";
              await fs.writeFile(temp, data, "utf8");
              await fs.rename(temp, notePath);
            });
          writes = run;
          return run;
        };
        const saveBytes = async (name, bytes) => {
          const result = await dialog.showSaveDialog(window, {
            defaultPath: path.join(app.getPath("downloads"), name.replace(/[<>:"/\\|?*]/g, "_")),
          });
          if (result.canceled || !result.filePath) return false;
          // Never replace an existing file; a fresh name keeps previous exports intact.
          try {
            await fs.writeFile(result.filePath, bytes, { flag: "wx" });
          } catch (e) {
            if (e.code === "EEXIST")
              throw Error("这个文件已存在，请换一个文件名保存。", { cause: e });
            throw e;
          }
          return true;
        };
        const capture = async (rect) => {
          const [width, height] = window.getContentSize();
          if (
            !rect ||
            !["x", "y", "width", "height"].every((k) => Number.isFinite(rect[k])) ||
            rect.width < 1 ||
            rect.height < 1 ||
            rect.x < 0 ||
            rect.y < 0 ||
            rect.x + rect.width > width + 1 ||
            rect.y + rect.height > height + 1
          )
            throw Error("请让素材完整显示后再复制或下载。");
          return window.webContents.capturePage(
            Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, Math.round(v)])),
          );
        };
        const handle = (name, fn) =>
          ipcMain.handle("asset-studio:" + name, async (event, ...args) => {
            if (event.sender !== window.webContents || event.senderFrame?.url !== entry)
              throw Error("无效页面");
            try {
              return { ok: true, value: await fn(...args) };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          });
        handle("readNotes", async () => {
          try {
            return validateNotes(JSON.parse(await readNoteFile()));
          } catch (e) {
            if (e.code === "ENOENT") return null;
            throw Error("已保存的审核记录无法读取；原文件已保留，请先恢复备份。", { cause: e });
          }
        });
        handle("saveNotes", writeNotes);
        handle("exportNotes", (notes) =>
          saveBytes(
            "上号素材审核意见-" + Date.now() + ".json",
            JSON.stringify({ version: manifest.version, notes: validateNotes(notes) }, null, 2),
          ),
        );
        handle("importNotes", async () => {
          const pick = await dialog.showOpenDialog(window, {
            properties: ["openFile"],
            filters: [{ name: "审核意见", extensions: ["json"] }],
          });
          if (pick.canceled) return null;
          const file = pick.filePaths[0];
          if ((await fs.stat(file)).size > 5 * 1024 * 1024) throw Error("审核文件过大");
          return validateNotes(JSON.parse(await fs.readFile(file, "utf8")).notes);
        });
        handle("downloadAsset", async (relative) => {
          if (!assets.has(relative)) throw Error("找不到素材");
          const shared = assets.get(relative).bundledFile;
          if (
            shared &&
            (!manifest.packaged || !/^[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|svg|ico)$/i.test(shared))
          )
            throw Error("无效素材路径");
          const allowed = shared
            ? path.resolve(root, "../app.asar/dist/assets")
            : path.join(root, "assets");
          const file = shared ? path.join(allowed, shared) : path.resolve(allowed, relative),
            real = await fs.realpath(file);
          if (!real.startsWith(allowed + path.sep)) throw Error("无效素材路径");
          return saveBytes(path.basename(relative), await fs.readFile(real));
        });
        handle("copyPng", async (data) => {
          if (
            typeof data !== "string" ||
            !data.startsWith("data:image/png;base64,") ||
            data.length > 32 * 1024 * 1024
          )
            throw Error("图片格式不支持");
          const image = nativeImage.createFromDataURL(data);
          if (image.isEmpty()) throw Error("无法读取图片");
          clipboard.writeImage(image);
          return true;
        });
        handle("capture", async (rect, action, name) => {
          const image = await capture(rect);
          if (action === "copy") {
            clipboard.writeImage(image);
            return true;
          }
          if (action === "save") return saveBytes(name + ".png", image.toPNG());
          throw Error("无效操作");
        });
        handle("copyText", (text) => {
          if (typeof text !== "string" || text.length > 10000) throw Error("内容过长");
          clipboard.writeText(text);
          return true;
        });
        window = new BrowserWindow({
          show,
          width: 1440,
          height: 1000,
          minWidth: 900,
          minHeight: 650,
          title: "上号素材",
          autoHideMenuBar: true,
          backgroundColor: "#f5f7fa",
          icon: path.join(root, "studio.ico"),
          webPreferences: {
            preload: path.join(root, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            offscreen: !show,
            backgroundThrottling: show,
          },
        });
        if (process.platform === "win32")
          window.setAppDetails({
            appId: "ShangHao.AssetStudio",
            appIconPath: path.join(root, "studio.ico"),
            relaunchDisplayName: "上号素材",
            relaunchCommand: app.isPackaged
              ? `"${process.execPath}" --asset-studio`
              : `"${process.execPath}" "${root}"`,
          });
        let drained = false;
        app.on("before-quit", (event) => {
          if (drained) return;
          event.preventDefault();
          drained = true;
          void writes.catch(() => {}).finally(() => app.quit());
        });
        window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
          callback(false),
        );
        window.webContents.setWindowOpenHandler(({ url }) => {
          if (url.startsWith("https://")) void shell.openExternal(url);
          return { action: "deny" };
        });
        window.webContents.on("will-navigate", (event, url) => {
          if (url !== entry) event.preventDefault();
        });
        await window.loadFile(path.join(root, "index.html"));
      })
      .catch((error) => {
        dialog.showErrorBox("上号素材无法打开", error.message);
        app.exit(1);
      });
    app.on("window-all-closed", () => app.quit());
  }
}
module.exports = { startStudio };
if (require.main === module) startStudio();
