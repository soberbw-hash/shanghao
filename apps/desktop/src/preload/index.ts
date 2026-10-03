import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type DesktopApi } from "@private-voice/shared";

const desktopApi: DesktopApi = {
  roomMemory: {
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.roomMemory.get, id),
    save: (request) => ipcRenderer.invoke(IPC_CHANNELS.roomMemory.save, request),
  },
  storage: {
    inspect: () => ipcRenderer.invoke(IPC_CHANNELS.storage.inspect),
    clearExpiredTemporary: () => ipcRenderer.invoke(IPC_CHANNELS.storage.clearExpiredTemporary),
  },
  rooms: {
    mine: () => ipcRenderer.invoke(IPC_CHANNELS.rooms.mine),
    find: (code) => ipcRenderer.invoke(IPC_CHANNELS.rooms.find, code),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.rooms.get, id),
    randomCode: () => ipcRenderer.invoke(IPC_CHANNELS.rooms.randomCode),
    available: (code) => ipcRenderer.invoke(IPC_CHANNELS.rooms.available, code),
    create: (request) => ipcRenderer.invoke(IPC_CHANNELS.rooms.create, request),
    update: (request) => ipcRenderer.invoke(IPC_CHANNELS.rooms.update, request),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.rooms.delete, id),
    kick: (id, peer) => ipcRenderer.invoke(IPC_CHANNELS.rooms.kick, id, peer),
    ban: (id, user, name) => ipcRenderer.invoke(IPC_CHANNELS.rooms.ban, id, user, name),
    unban: (id, user) => ipcRenderer.invoke(IPC_CHANNELS.rooms.unban, id, user),
    bans: (id) => ipcRenderer.invoke(IPC_CHANNELS.rooms.bans, id),
    history: () => ipcRenderer.invoke(IPC_CHANNELS.rooms.history),
    rememberJoined: (id) => ipcRenderer.invoke(IPC_CHANNELS.rooms.rememberJoined, id),
    favorite: (id, enabled) => ipcRenderer.invoke(IPC_CHANNELS.rooms.favorite, id, enabled),
  },
  phoneMode: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.phoneMode.get),
    set: (active) => ipcRenderer.invoke(IPC_CHANNELS.phoneMode.set, active),
    devices: (devices) => ipcRenderer.invoke(IPC_CHANNELS.phoneMode.devices, devices),
    configure: (shortcut, trigger) =>
      ipcRenderer.invoke(IPC_CHANNELS.phoneMode.configure, shortcut, trigger),
    onChanged: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);
      ipcRenderer.on(IPC_CHANNELS.phoneMode.changed, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.phoneMode.changed, wrapped);
    },
  },
  app: {
    setBackgroundActivity: (activity) =>
      ipcRenderer.invoke(IPC_CHANNELS.app.backgroundActivity, activity),
    completeBackgroundClose: (id, leftRoom) =>
      ipcRenderer.invoke(IPC_CHANNELS.app.completeBackgroundClose, id, leftRoom),
    onBackgroundCommand: (listener) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        command: Parameters<typeof listener>[0],
      ) => listener(command);
      ipcRenderer.on(IPC_CHANNELS.app.backgroundCommand, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.app.backgroundCommand, wrapped);
    },
    getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.app.getRuntimeInfo),
    openAssetStudio: () => ipcRenderer.invoke(IPC_CHANNELS.app.openAssetStudio),
    createAssetStudioShortcut: () => ipcRenderer.invoke(IPC_CHANNELS.app.createAssetStudioShortcut),
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
    getChatLinkPreview: (url) => ipcRenderer.invoke(IPC_CHANNELS.app.getChatLinkPreview, url),
    openSystemSettings: (page) => ipcRenderer.invoke(IPC_CHANNELS.app.openSystemSettings, page),
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
    getPhoneMicHostTicket: (relayUrl) =>
      ipcRenderer.invoke(IPC_CHANNELS.audio.getPhoneMicHostTicket, relayUrl),
    getDeepFilterAssets: () => ipcRenderer.invoke(IPC_CHANNELS.audio.getDeepFilterAssets),
    listPhoneMicUsbDevices: () => ipcRenderer.invoke(IPC_CHANNELS.audio.listPhoneMicUsbDevices),
    startPhoneMicUsb: (serial) => ipcRenderer.invoke(IPC_CHANNELS.audio.startPhoneMicUsb, serial),
    stopPhoneMicUsb: () => ipcRenderer.invoke(IPC_CHANNELS.audio.stopPhoneMicUsb),
  },
  quickMessages: {
    export: () => ipcRenderer.invoke(IPC_CHANNELS.quickMessages.export),
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
    requestMuteQuickMessage: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.overlay.requestMuteQuickMessage, request),
    onState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => {
        listener(state as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.overlay.state, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.state, wrapped);
    },
    onQuickMessageMute: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, request: unknown) => {
        listener(request as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.overlay.muteQuickMessage, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.muteQuickMessage, wrapped);
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
    clearTranscriptionResults: (recordingId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.clearTranscriptionResults, recordingId),
    publishOrganization: (recordingId) =>
      ipcRenderer.invoke(IPC_CHANNELS.ai.publishOrganization, recordingId),
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
    getRememberedLogin: () => ipcRenderer.invoke(IPC_CHANNELS.account.getRememberedLogin),
    configureCloudBase: (config) =>
      ipcRenderer.invoke(IPC_CHANNELS.account.configureCloudBase, config),
    login: (request) => ipcRenderer.invoke(IPC_CHANNELS.account.login, request),
    register: (request) => ipcRenderer.invoke(IPC_CHANNELS.account.register, request),
    requestVerificationCode: (phone) =>
      ipcRenderer.invoke(IPC_CHANNELS.account.requestVerificationCode, phone),
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
    onMuteTriggered: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(IPC_CHANNELS.shortcuts.muteTriggered, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.muteTriggered, wrapped);
    },
    onRecordingMarkerTriggered: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(IPC_CHANNELS.shortcuts.recordingMarkerTriggered, wrapped);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.recordingMarkerTriggered, wrapped);
    },
    onPushToTalkState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, pressed: unknown) => {
        if (typeof pressed === "boolean") listener(pressed);
      };
      ipcRenderer.on(IPC_CHANNELS.shortcuts.pushToTalkState, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.pushToTalkState, wrapped);
    },
    onQuickMessageTriggered: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, slot: unknown) => {
        if (typeof slot === "number") listener(slot);
      };
      ipcRenderer.on(IPC_CHANNELS.shortcuts.quickMessageTriggered, wrapped);
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.quickMessageTriggered, wrapped);
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
    exportClip: (request) => ipcRenderer.invoke(IPC_CHANNELS.recording.exportClip, request),
    showClipInFolder: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.showClipInFolder, filePath),
    dragClip: (filePath) => ipcRenderer.send(IPC_CHANNELS.recording.dragClip, filePath),
    export: (payload) => ipcRenderer.invoke(IPC_CHANNELS.recording.export, payload),
    startSession: (payload) => ipcRenderer.invoke(IPC_CHANNELS.recording.startSession, payload),
    appendChunk: (sessionId, buffer) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.appendChunk, sessionId, buffer),
    finalizeSession: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.finalizeSession, payload),
    sealSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recording.sealSession, sessionId),
    abortSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.recording.abortSession, sessionId),
    saveSpeakerSegment: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.saveSpeakerSegment, payload),
    finalizeSpeakerSegments: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.finalizeSpeakerSegments, payload),
    saveParticipantTrack: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.saveParticipantTrack, payload),
    finalizeParticipantTracks: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.finalizeParticipantTracks, payload),
    chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.recording.chooseDirectory),
    saveMarkers: (filePath, markers) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.saveMarkers, filePath, markers),
    saveOrigin: (filePath, roomId, roomName) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.saveOrigin, filePath, roomId, roomName),
    applyAutomaticCleanup: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.applyAutomaticCleanup, filePath),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.recording.list),
    scanWaste: () => ipcRenderer.invoke(IPC_CHANNELS.recording.scanWaste),
    cleanWaste: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.recording.cleanWaste, filePaths),
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
    showItemInFolder: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.recording.showItemInFolder, filePath),
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
