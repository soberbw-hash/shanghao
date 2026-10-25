import type {
  RemoteControlDuration,
  RemoteControlInputEvent,
  RemoteControlLane,
  RemoteControlResult,
  RemoteControlShareGeometry,
} from "./remote-control.types";
import type {
  RemoteControlServiceSnapshot,
  RemoteControlWireMessage,
} from "./remote-control-service.types";

export interface RemoteControlOutgoing {
  peerId: string;
  message: RemoteControlWireMessage;
  lane: RemoteControlLane;
}
export type RemoteControlViewerClient = Pick<
  RemoteControlApi,
  "get" | "request" | "cancel" | "stopControlling" | "remoteFrame" | "input" | "onState"
>;
/** Bound by Main; no caller-provided peer or share identifiers. */
export interface DetachedRemoteControlApi {
  get: () => Promise<RemoteControlServiceSnapshot>;
  request: () => Promise<RemoteControlResult<unknown>>;
  cancel: () => Promise<void>;
  stop: () => Promise<void>;
  frame: () => void;
  input: (event: RemoteControlInputEvent, lane: RemoteControlLane) => void;
  onState: (listener: (state: RemoteControlServiceSnapshot) => void) => () => void;
}
export interface RemoteControlApi {
  get: () => Promise<RemoteControlServiceSnapshot>;
  getCapture: () => Promise<RemoteControlShareGeometry | undefined>;
  captureFrame: (handle: string, geometryVersion: number) => void;
  endCapture: (handle: string) => Promise<void>;
  peerCapability: (peerId: string, available: boolean) => void;
  receive: (peerId: string, message: RemoteControlWireMessage, lane: RemoteControlLane) => void;
  approve: (
    requestId: string,
    duration: RemoteControlDuration,
  ) => Promise<RemoteControlResult<unknown>>;
  deny: (requestId: string) => Promise<RemoteControlResult>;
  pause: () => Promise<RemoteControlResult>;
  resume: () => Promise<RemoteControlResult<unknown>>;
  revoke: () => Promise<void>;
  request: (peerId: string) => Promise<RemoteControlResult<unknown>>;
  cancel: (peerId: string) => Promise<void>;
  stopControlling: (peerId: string) => Promise<void>;
  remoteFrame: (peerId: string, shareSessionId: string) => void;
  input: (peerId: string, event: RemoteControlInputEvent, lane: RemoteControlLane) => void;
  onState: (listener: (state: RemoteControlServiceSnapshot) => void) => () => void;
  onOutgoing: (listener: (message: RemoteControlOutgoing) => void) => () => void;
}
