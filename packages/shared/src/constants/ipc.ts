export const IPC_CHANNELS = {
  app: {
    getRuntimeInfo: "app:get-runtime-info",
    writeLog: "app:write-log",
  },
  window: {
    minimize: "window:minimize",
    hide: "window:hide",
    close: "window:close",
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
  },
  shortcuts: {
    configureMute: "shortcuts:configure-mute",
    muteTriggered: "shortcuts:mute-triggered",
  },
  tailscale: {
    checkStatus: "tailscale:check-status",
    openInstallGuide: "tailscale:open-install-guide",
  },
  host: {
    start: "host:start",
    stop: "host:stop",
    diagnoseJoin: "host:diagnose-join",
  },
  recording: {
    export: "recording:export",
  },
} as const;
