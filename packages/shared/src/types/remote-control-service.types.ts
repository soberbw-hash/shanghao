import type {
  RemoteControlGrant,
  RemoteControlInputEnvelope,
  RemoteControlMemberIdentity,
  RemoteControlRequest,
  RemoteControlSnapshot,
} from "./remote-control.types";

export interface HostShareInfo {
  roomId: string;
  shareSessionId: string;
  captureHandle: string;
  displayId: string;
  geometryVersion: number;
  owner: RemoteControlMemberIdentity;
  kind: "screen" | "window";
  width: number;
  height: number;
  /** Potentially requestable; this is not a native capability or an authorization. */
  requestable: boolean;
}

export type RemoteControlWireMessage =
  | { v: 1; type: "share-info"; share: HostShareInfo | null }
  | { v: 1; type: "request-control"; requestId: string; shareSessionId: string }
  /** Legacy development transport; Main ignores all claimed bindings and timestamps. */
  | { v: 1; type: "request"; request: RemoteControlRequest }
  | { v: 1; type: "cancel"; requestId: string }
  | { v: 1; type: "grant"; grant: RemoteControlGrant }
  | { v: 1; type: "deny"; requestId: string; reason: string }
  | { v: 1; type: "revoke"; grantId: string; generation: number; reason: string }
  | { v: 1; type: "pause"; grantId: string; generation: number }
  | { v: 1; type: "clock-request"; nonce: string; controllerTimeMs: number }
  | { v: 1; type: "clock-response"; nonce: string; controllerTimeMs: number; hostTimeMs: number }
  | { v: 1; type: "input"; input: RemoteControlInputEnvelope };

export interface RemoteControlNativeCapabilities {
  supported: boolean;
  emergencyStopReady: boolean;
  dryRun: boolean;
}
export interface RemoteControlControllerSnapshot {
  remoteShares: Record<string, HostShareInfo>;
  outgoingRequests: Record<string, RemoteControlRequest>;
  remoteGrants: Record<string, { grant: RemoteControlGrant; paused: boolean }>;
}
export interface RemoteControlServiceSnapshot extends RemoteControlControllerSnapshot {
  host: RemoteControlSnapshot;
  incomingRequests: RemoteControlRequest[];
  native?: RemoteControlNativeCapabilities;
}
