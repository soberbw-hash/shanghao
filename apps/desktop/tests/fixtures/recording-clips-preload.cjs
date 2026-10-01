/* eslint-disable @typescript-eslint/no-require-imports */
/* global require */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopApi", {
  app: {
    setBackgroundActivity: (activity) => ipcRenderer.invoke("app:background-activity", activity),
    completeBackgroundClose: (id, left) =>
      ipcRenderer.invoke("app:complete-background-close", id, left),
    onBackgroundCommand: (handler) => {
      const listener = (_event, command) => handler(command);
      ipcRenderer.on("app:background-command", listener);
      return () => ipcRenderer.removeListener("app:background-command", listener);
    },
  },
  recording: {
    exportClip: (request) => ipcRenderer.invoke("recording:export-clip", request),
    showClipInFolder: (file) => ipcRenderer.invoke("recording:show-clip-in-folder", file),
    dragClip: (file) => ipcRenderer.send("recording:drag-clip", file),
  },
  review: {
    load: () => ipcRenderer.invoke("review:load"),
    save: (patch) => ipcRenderer.invoke("review:save", patch),
  },
});
