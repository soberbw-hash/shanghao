import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type DesktopApi } from "@private-voice/shared";

const desktopApi: DesktopApi = {
  app: {
    getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.app.getRuntimeInfo),
    getSystemIdleSeconds: () => ipcRenderer.invoke(IPC_CHANNELS.app.getSystemIdleSeconds),
    writeLog: (payload) => ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, payload),
    notify: (payload) => ipcRenderer.invoke(IPC_CHANNELS.app.notify, payload),
    onLifecycleRecovery: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, notice: unknown) => {
        listener(notice as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.app.lifecycleRecovery, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.app.lifecycleRecovery, wrapped);
    },
    readChatHistory: (payload) => ipcRenderer.invoke(IPC_CHANNELS.app.readChatHistory, payload),
    saveChatHistory: (payload) => ipcRenderer.invoke(IPC_CHANNELS.app.saveChatHistory, payload),
    readDailyRoomReports: () => ipcRenderer.invoke(IPC_CHANNELS.app.readDailyRoomReports),
    saveDailyRoomReports: (reports) =>
      ipcRenderer.invoke(IPC_CHANNELS.app.saveDailyRoomReports, reports),
    openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.app.openExternal, url),
    openSystemSettings: (page) => ipcRenderer.invoke(IPC_CHANNELS.app.openSystemSettings, page),
    getLinkPreviewIcon: (url) => ipcRenderer.invoke(IPC_CHANNELS.app.getLinkPreviewIcon, url),
    consumeDeepLink: () => ipcRenderer.invoke(IPC_CHANNELS.app.consumeDeepLink),
    onDeepLink: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, invite: unknown) => {
        listener(invite as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.app.deepLink, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.app.deepLink, wrapped);
    },
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC_CHANNELS.clipboard.writeText, text),
    writeImage: (dataUrl) => ipcRenderer.invoke(IPC_CHANNELS.clipboard.writeImage, dataUrl),
  },
  audio: {
    getDeepFilterAssets: () => ipcRenderer.invoke(IPC_CHANNELS.audio.getDeepFilterAssets),
  },
  screenCapture: {
    listSources: () => ipcRenderer.invoke(IPC_CHANNELS.screenCapture.listSources),
    selectSource: (sourceId) =>
      ipcRenderer.invoke(IPC_CHANNELS.screenCapture.selectSource, sourceId),
    setContentProtection: (enabled) =>
      ipcRenderer.invoke(IPC_CHANNELS.screenCapture.setContentProtection, enabled),
  },
  screenShareViewer: {
    open: (request) => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.open, request),
    sendSignal: (signal) => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.sendSignal, signal),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.close),
    onSignal: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, signal: unknown) => {
        listener(signal as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.screenShareViewer.signal, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.screenShareViewer.signal, wrapped);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.window.hide),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close),
    show: () => ipcRenderer.invoke(IPC_CHANNELS.window.show),
  },
  overlay: {
    show: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.show),
    toggle: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.toggle),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.close),
    update: (state) => ipcRenderer.invoke(IPC_CHANNELS.overlay.update, state),
    setInteractive: (interactive) =>
      ipcRenderer.invoke(IPC_CHANNELS.overlay.setInteractive, interactive),
    moveTo: (screenY) => ipcRenderer.invoke(IPC_CHANNELS.overlay.moveTo, screenY),
    resetPosition: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.resetPosition),
    onState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => {
        listener(state as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.overlay.state, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.state, wrapped);
    },
    onHoverState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, inside: unknown) => {
        listener(inside === true);
      };
      ipcRenderer.on(IPC_CHANNELS.overlay.hoverState, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.hoverState, wrapped);
    },
  },
  games: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.games.getSnapshot),
    onDetected: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
        listener(snapshot as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.games.detected, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.games.detected, wrapped);
    },
  },
  weather: {
    getSnapshot: (request) => ipcRenderer.invoke(IPC_CHANNELS.weather.getSnapshot, request),
  },
  ai: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.ai.getSnapshot),
    controlModel: (modelId, action) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.controlModel, modelId, action),
    getRuntimeStatus: () => ipcRenderer.invoke(IPC_CHANNELS.ai.runtimeStatus),
    getVoiceMemory: (recordingId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.getVoiceMemory, recordingId),
    listVoiceMemories: () => ipcRenderer.invoke(IPC_CHANNELS.ai.listVoiceMemories),
    processRecording: (request) => ipcRenderer.invoke(IPC_CHANNELS.ai.processRecording, request),
    selectTranscription: (recordingId, modelId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.selectTranscription, recordingId, modelId),
    pauseTask: (recordingId) => ipcRenderer.invoke(IPC_CHANNELS.ai.pauseTask, recordingId),
    resumeTask: (recordingId) => ipcRenderer.invoke(IPC_CHANNELS.ai.resumeTask, recordingId),
    assignSpeaker: (recordingId, speakerId, memberId, nickname) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.assignSpeaker, recordingId, speakerId, memberId, nickname),
    updateMarkerTitle: (recordingId, markerId, title) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.updateMarkerTitle, recordingId, markerId, title),
    askRecording: (request) => ipcRenderer.invoke(IPC_CHANNELS.ai.askRecording, request),
    askMemory: (request) => ipcRenderer.invoke(IPC_CHANNELS.ai.askMemory, request),
    cancelQuestion: () => ipcRenderer.invoke(IPC_CHANNELS.ai.cancelQuestion),
    getCustomProvider: () => ipcRenderer.invoke(IPC_CHANNELS.ai.getCustomProvider),
    saveCustomProvider: (input) => ipcRenderer.invoke(IPC_CHANNELS.ai.saveCustomProvider, input),
    clearCustomProvider: () => ipcRenderer.invoke(IPC_CHANNELS.ai.clearCustomProvider),
    getHuggingFaceAccess: () => ipcRenderer.invoke(IPC_CHANNELS.ai.getHuggingFaceAccess),
    saveHuggingFaceAccess: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.saveHuggingFaceAccess, input),
    clearHuggingFaceAccess: () => ipcRenderer.invoke(IPC_CHANNELS.ai.clearHuggingFaceAccess),
    searchMemory: (request) => ipcRenderer.invoke(IPC_CHANNELS.ai.searchMemory, request),
    updateRuntimePressure: (pressure) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.updateRuntimePressure, pressure),
    onStatus: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
        listener(snapshot as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.ai.status, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ai.status, wrapped);
    },
    onVoiceMemoryStatus: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, record: unknown) => {
        listener(record as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.ai.voiceMemoryStatus, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.ai.voiceMemoryStatus, wrapped);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.settings.reset),
  },
  account: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.account.getSnapshot),
    login: (request) => ipcRenderer.invoke(IPC_CHANNELS.account.login, request),
    register: (request) => ipcRenderer.invoke(IPC_CHANNELS.account.register, request),
    requestPasswordReset: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.account.requestPasswordReset, request),
    updateProfile: (request) => ipcRenderer.invoke(IPC_CHANNELS.account.updateProfile, request),
    updateAvatar: (request) => ipcRenderer.invoke(IPC_CHANNELS.account.updateAvatar, request),
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.account.logout),
    continueAsGuest: () => ipcRenderer.invoke(IPC_CHANNELS.account.continueAsGuest),
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
        listener(snapshot as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.account.changed, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.account.changed, wrapped);
    },
  },
  profile: {
    pickAvatar: () => ipcRenderer.invoke(IPC_CHANNELS.profile.pickAvatar),
    readAvatar: (avatarPath) => ipcRenderer.invoke(IPC_CHANNELS.profile.readAvatar, avatarPath),
    clearAvatar: (avatarPath) => ipcRenderer.invoke(IPC_CHANNELS.profile.clearAvatar, avatarPath),
  },
  diagnostics: {
    snapshot: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.snapshot),
    runtimeHealth: (renderer) =>
      ipcRenderer.invoke(IPC_CHANNELS.diagnostics.runtimeHealth, renderer),
    testServer: (serverUrl) => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.testServer, serverUrl),
    exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.exportLogs),
    exportBundle: (rendererState) =>
      ipcRenderer.invoke(IPC_CHANNELS.diagnostics.exportBundle, rendererState),
    openLogsDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.openLogsDirectory),
  },
  windows: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.windows.getStatus),
    repairFirewall: () => ipcRenderer.invoke(IPC_CHANNELS.windows.repairFirewall),
    removeFirewall: () => ipcRenderer.invoke(IPC_CHANNELS.windows.removeFirewall),
    setIconOverlaysHidden: (hidden) =>
      ipcRenderer.invoke(IPC_CHANNELS.windows.setIconOverlaysHidden, hidden),
  },
  shortcuts: {
    configureMute: (accelerator) =>
      ipcRenderer.invoke(IPC_CHANNELS.shortcuts.configureMute, accelerator),
    onMuteTriggered: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(IPC_CHANNELS.shortcuts.muteTriggered, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.muteTriggered, wrapped);
    },
    configureRecordingMarker: (accelerator) =>
      ipcRenderer.invoke(IPC_CHANNELS.shortcuts.configureRecordingMarker, accelerator),
    onRecordingMarkerTriggered: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(IPC_CHANNELS.shortcuts.recordingMarkerTriggered, wrapped);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.recordingMarkerTriggered, wrapped);
    },
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.updates.check),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.updates.download),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.updates.install),
    onStatus: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, status: unknown) => {
        listener(status as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.updates.status, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.updates.status, wrapped);
    },
    openReleases: () => ipcRenderer.invoke(IPC_CHANNELS.updates.openReleases),
  },
  signaling: {
    connect: (signalingUrl, sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.signaling.connect, signalingUrl, sessionId),
    send: (payload, sessionId) =>
      ipcRenderer.invoke(IPC_CHANNELS.signaling.send, payload, sessionId),
    close: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.signaling.close, sessionId),
    injectFault: (sessionId, command) =>
      ipcRenderer.invoke(IPC_CHANNELS.signaling.injectFault, sessionId, command),
    onEvent: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        listener(payload as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.signaling.event, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.signaling.event, wrapped);
    },
  },
  recording: {
    export: (payload) => ipcRenderer.invoke(IPC_CHANNELS.recording.export, payload),
    saveSpeakerSegment: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.saveSpeakerSegment, payload),
    finalizeSpeakerSegments: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.finalizeSpeakerSegments, payload),
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.recording.chooseDirectory),
    saveMarkers: (filePath, markers) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.saveMarkers, filePath, markers),
    applyAutomaticCleanup: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.applyAutomaticCleanup, filePath),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.recording.list),
    scanWaste: () => ipcRenderer.invoke(IPC_CHANNELS.recording.scanWaste),
    onScanWasteProgress: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) => {
        listener(progress as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.recording.scanWasteProgress, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.recording.scanWasteProgress, wrapped);
    },
    setFavorite: (filePath, isFavorite) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.setFavorite, filePath, isFavorite),
    rename: (recordingId, title) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.rename, recordingId, title),
    openDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.recording.openDirectory),
    delete: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.recording.delete, filePath),
    deleteMany: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.recording.deleteMany, filePaths),
  },
};

void ipcRenderer
  .invoke(IPC_CHANNELS.app.writeLog, {
    category: "app",
    level: "info",
    message: "Preload bridge initialized",
  })
  .catch(() => undefined);

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
