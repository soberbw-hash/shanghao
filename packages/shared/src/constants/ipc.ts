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
  tailscale: {
    checkStatus: "tailscale:check-status",
    openInstallGuide: "tailscale:open-install-guide",
  },
  network: {
    getSnapshot: "network:get-snapshot",
    getProxyDiagnostics: "network:get-proxy-diagnostics",
  },
  host: {
    start: "host:start",
    stop: "host:stop",
    diagnoseJoin: "host:diagnose-join",
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
} as const;
