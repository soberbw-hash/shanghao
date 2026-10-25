/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "detached-control-ipc");
require("tsx/cjs");
const {
  registerRemoteControlViewerIpc,
  publishRemoteControlViewerState,
} = require("../src/main/remote-control-viewer-ipc.ts");
const {
  remoteControlViewerBinding: binding,
} = require("../src/main/remote-control-viewer-binding.ts");
const { IPC_CHANNELS } = require("../../../packages/shared/src/constants/ipc.ts");
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const windows = [];
  try {
    const create = () => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          nodeIntegrationInSubFrames: true,
          contextIsolation: false,
        },
      });
      windows.push(w);
      return w;
    };
    const viewer = create(),
      stranger = create();
    let current = viewer;
    const share = {
      roomId: "room",
      shareSessionId: "share",
      captureHandle: "capture",
      displayId: "display",
      geometryVersion: 1,
      owner: { peerId: "friend", deviceId: "d", memberSessionId: "s", memberGeneration: 1 },
      kind: "screen",
      width: 1920,
      height: 1080,
      requestable: true,
    };
    const state = {
      host: { phase: "active", requests: [] },
      incomingRequests: [{ requestId: "private" }],
      remoteShares: { friend: share },
      outgoingRequests: {},
      remoteGrants: {},
    };
    const calls = [];
    registerRemoteControlViewerIpc(
      {
        snapshot: () => state,
        refresh: () => {},
        requestControl: (peer) => {
          calls.push(["request", peer]);
          return { ok: true };
        },
        cancelRequest: (peer) => calls.push(["cancel", peer]),
        stopControlling: (peer) => calls.push(["stop", peer]),
        observeRemoteFrame: (peer, session) => calls.push(["frame", peer, session]),
        sendInput: (peer, event, lane) => calls.push(["input", peer, event, lane]),
      },
      () => current,
    );
    binding.bind(viewer.webContents.id, "session", "friend");
    const html = "data:text/html,<body>isolated<iframe srcdoc='<p>child</p>'></iframe></body>";
    await Promise.all([viewer.loadURL(html), stranger.loadURL(html)]);
    const channels = IPC_CHANNELS.screenShareViewer;
    const invoke = (contents, name, ...args) =>
      contents.executeJavaScript(
        `require('electron').ipcRenderer.invoke(${JSON.stringify(channels[name])},...${JSON.stringify(args)})`,
      );
    let denied = false;
    try {
      await invoke(stranger.webContents, "controlGet");
    } catch {
      denied = true;
    }
    if (!denied) throw Error("stranger got control state");
    const projected = await invoke(viewer.webContents, "controlGet");
    if (projected.host.phase !== "idle" || projected.incomingRequests.length)
      throw Error("host authority leaked");
    // Extra peer/share arguments are ignored by the production IPC handler.
    await invoke(viewer.webContents, "controlRequest", "attacker-peer", "attacker-share");
    if (JSON.stringify(calls[0]) !== '["request","friend"]') throw Error("viewer retargeted peer");
    const child = viewer.webContents.mainFrame.frames[0];
    denied = false;
    try {
      await child.executeJavaScript(
        `require('electron').ipcRenderer.invoke(${JSON.stringify(channels.controlRequest)})`,
      );
    } catch {
      denied = true;
    }
    if (!denied || calls.length !== 1) throw Error("subframe reached control authority");
    await viewer.webContents.executeJavaScript(
      `require('electron').ipcRenderer.send(${JSON.stringify(channels.controlFrame)},'forged-peer','forged-share');require('electron').ipcRenderer.send(${JSON.stringify(channels.controlInput)},{kind:'text',text:'fixture'},'reliable')`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (
      !calls.some((c) => c[0] === "frame" && c[1] === "friend" && c[2] === "share") ||
      !calls.some((c) => c[0] === "input" && c[1] === "friend")
    )
      throw Error("bound forwarding failed");
    share.geometryVersion++;
    publishRemoteControlViewerState();
    const stale = await invoke(viewer.webContents, "controlRequest");
    if (stale.ok || calls.filter((c) => c[0] === "request").length !== 1)
      throw Error("stale geometry accepted");
    current = stranger;
    denied = false;
    try {
      await invoke(viewer.webContents, "controlGet");
    } catch {
      denied = true;
    }
    if (!denied) throw Error("old viewer retained IPC identity");
    const secure = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: require("node:path").resolve(
          __dirname,
          "../dist-electron/preload/screen-share-viewer.cjs",
        ),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    windows.push(secure);
    current = secure;
    binding.bind(secure.webContents.id, "secure-session", "friend");
    await secure.loadURL("data:text/html,<p>production preload</p>");
    const exposed = await secure.webContents.executeJavaScript(`(async()=>{
      const api=window.screenShareViewerApi.control;
      if(window.desktopApi||api.approve||api.receive||api.captureFrame||api.getCapture)throw Error('excess viewer authority');
      const state=await api.get();const result=await api.request('forged-peer');
      return result.ok&&Object.keys(state.remoteShares).join(',')==='friend';
    })()`);
    if (!exposed) throw Error("production preload binding failed");
    console.log(
      JSON.stringify({
        mainFrameBound: true,
        noHostAuthority: true,
        noPeerRetarget: true,
        subframeDenied: true,
        exactShareFrame: true,
        geometryInvalidation: true,
        oldWindowDenied: true,
        productionSandboxPreload: true,
        nativeInputInjected: false,
      }),
    );
    clearTimeout(deadline);
    windows.forEach((w) => w.destroy());
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
