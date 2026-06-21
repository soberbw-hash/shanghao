export const IPC_CHANNELS = {
  app: {
    getRuntimeInfo: "app:get-runtime-info",
    writeLog: "app:write-log",
    openPath: "app:open-path",
  },
  window: {
    minimize: "window:minimize",
    hide: "window:hide",
    close: "window:close",
    show: "window:show",
  },
  overlay: {
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
  },
  llm: {
    chat: "llm:chat",
    health: "llm:health",
  },
} as const;
