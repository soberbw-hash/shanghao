export const IPC_CHANNELS = {
  app: {
    getRuntimeInfo: "app:get-runtime-info",
    writeLog: "app:write-log",
    openPath: "app:open-path",
    notify: "app:notify",
  },
  clipboard: {
    writeText: "clipboard:write-text",
  },
  window: {
    minimize: "window:minimize",
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
    exportLogs: "diagnostics:export-logs",
    exportBundle: "diagnostics:export-bundle",
    openLogsDirectory: "diagnostics:open-logs-directory",
  },
  shortcuts: {
    configureMute: "shortcuts:configure-mute",
    muteTriggered: "shortcuts:mute-triggered",
    configurePushToTalk: "shortcuts:configure-push-to-talk",
    pushToTalkState: "shortcuts:push-to-talk-state",
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
  llm: {
    chat: "llm:chat",
    health: "llm:health",
  },
} as const;
