const { contextBridge, ipcRenderer } = require("electron");
const call = async (name, ...args) => {
  const result = await ipcRenderer.invoke("asset-studio:" + name, ...args);
  if (!result.ok) throw Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld("assetStudio", {
  readNotes: () => call("readNotes"),
  saveNotes: (notes) => call("saveNotes", notes),
  exportNotes: (notes) => call("exportNotes", notes),
  importNotes: () => call("importNotes"),
  downloadAsset: (relative) => call("downloadAsset", relative),
  copyPng: (data) => call("copyPng", data),
  capture: (rect, action, name) => call("capture", rect, action, name),
  copyText: (text) => call("copyText", text),
});
