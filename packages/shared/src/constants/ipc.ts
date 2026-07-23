export const IPC_CHANNELS = {
  app: {
    getRuntimeInfo: "app:get-runtime-info",
    getSystemIdleSeconds: "app:get-system-idle-seconds",
    writeLog: "app:write-log",
    notify: "app:notify",
  },
  clipboard: {
    writeText: "clipboard:write-text",
  },
  screenCapture: {
    listSources: "screen-capture:list-sources",
    selectSource: "screen-capture:select-source",
    setContentProtection: "screen-capture:set-content-protection",
  },
  screenShareViewer: {
    open: "screen-share-viewer:open",
    sendSignal: "screen-share-viewer:send-signal",
    close: "screen-share-viewer:close",
    signal: "screen-share-viewer:signal",
  },
  window: {
    minimize: "window:minimize",
    toggleMaximize: "window:toggle-maximize",
    hide: "window:hide",
    close: "window:close",
    show: "window:show",
  },
  overlay: {
    show: "overlay:show",
    toggle: "overlay:toggle",
    close: "overlay:close",
    update: "overlay:update",
    state: "overlay:state",
  },
  games: {
    getSnapshot: "games:get-snapshot",
    detected: "games:detected",
  },
  settings: {
    get: "settings:get",
    save: "settings:save",
    reset: "settings:reset",
  },
  profile: {
    pickAvatar: "profile:pick-avatar",
    readAvatar: "profile:read-avatar",
    clearAvatar: "profile:clear-avatar",
  },
  diagnostics: {
    snapshot: "diagnostics:snapshot",
    testServer: "diagnostics:test-server",
    exportLogs: "diagnostics:export-logs",
    exportBundle: "diagnostics:export-bundle",
    openLogsDirectory: "diagnostics:open-logs-directory",
  },
  shortcuts: {
    configureMute: "shortcuts:configure-mute",
    muteTriggered: "shortcuts:mute-triggered",
    configureRecordingMarker: "shortcuts:configure-recording-marker",
    recordingMarkerTriggered: "shortcuts:recording-marker-triggered",
  },
  updates: {
    check: "updates:check",
    download: "updates:download",
    install: "updates:install",
    status: "updates:status",
    openReleases: "updates:open-releases",
  },
  signaling: {
    connect: "signaling:connect",
    send: "signaling:send",
    close: "signaling:close",
    event: "signaling:event",
  },
  recording: {
    export: "recording:export",
    saveMarkers: "recording:save-markers",
  },
} as const;
