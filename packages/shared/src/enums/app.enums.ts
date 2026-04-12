export enum AppBootState {
  Booting = "booting",
  Ready = "ready",
  Degraded = "degraded",
  Failed = "failed",
}

export enum RoomConnectionState {
  Idle = "idle",
  DetectingNetwork = "detecting_network",
  StartingHost = "starting_host",
  WaitingPeer = "waiting_peer",
  Joining = "joining",
  Handshaking = "handshaking",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Disconnected = "disconnected",
  Failed = "failed",
}

export enum RoomLifecycleState {
  Idle = "idle",
  Closed = "closed",
  Opening = "opening",
  Open = "open",
  Closing = "closing",
  Failed = "failed",
}

export enum HostSessionState {
  NotStarted = "not_started",
  Starting = "starting",
  Active = "active",
  Stopping = "stopping",
  Failed = "failed",
}

export enum MemberJoinState {
  Waiting = "waiting",
  Connecting = "connecting",
  Joined = "joined",
  Left = "left",
  Failed = "failed",
}

export enum MemberPresenceState {
  Offline = "offline",
  Connecting = "connecting",
  Online = "online",
  Reconnecting = "reconnecting",
}

export enum MemberSpeakingState {
  Silent = "silent",
  Speaking = "speaking",
  Muted = "muted",
}

export enum MicPermissionState {
  Unknown = "unknown",
  Granted = "granted",
  Denied = "denied",
  Prompt = "prompt",
  Unavailable = "unavailable",
}

export enum AudioDeviceState {
  Ready = "ready",
  Missing = "missing",
  Switching = "switching",
  Failed = "failed",
}

export enum RecordingState {
  Idle = "idle",
  Preparing = "preparing",
  Recording = "recording",
  Stopping = "stopping",
  Saving = "saving",
  Saved = "saved",
  Failed = "failed",
}

export enum RecordingEncoderState {
  CheckingSupport = "checking_support",
  NativeAacAvailable = "native_aac_available",
  FallbackTranscode = "fallback_transcode",
  Unsupported = "unsupported",
}

export enum PushToTalkState {
  Off = "off",
  Armed = "armed",
  Pressed = "pressed",
  Locked = "locked",
}

export enum TailscaleState {
  Unknown = "unknown",
  Checking = "checking",
  Installed = "installed",
  NotInstalled = "not_installed",
  Connected = "connected",
  Disconnected = "disconnected",
}

export enum ExportTaskState {
  Idle = "idle",
  Running = "running",
  Success = "success",
  Failed = "failed",
}
