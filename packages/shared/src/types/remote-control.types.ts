/** Identity comes from the authenticated room/Peer transport, never from an input payload. */
export interface RemoteControlMemberIdentity {
  peerId: string;
  memberSessionId: string;
  memberGeneration: number;
  deviceId: string;
}

export interface RemoteControlRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RemoteControlShareGeometry {
  kind: "screen" | "window";
  shareSessionId: string;
  captureHandle: string;
  displayId: string;
  geometryVersion: number;
  displayBoundsDip: RemoteControlRect;
  displayBoundsPhysical: RemoteControlRect;
  virtualDesktopBoundsPhysical: RemoteControlRect;
}

export interface RemoteControlBinding {
  roomId: string;
  shareSessionId: string;
  captureHandle: string;
  displayId: string;
  geometryVersion: number;
  target: RemoteControlMemberIdentity;
  controller: RemoteControlMemberIdentity;
}

export type RemoteControlDuration = "ten-minutes" | "share-lifetime";
export type RemoteControlLane = "reliable" | "pointer";
export type RemoteControlMouseButton = "left" | "right" | "middle";
export type RemoteControlPhase =
  "idle" | "pending" | "active" | "paused" | "revoked" | "expired" | "denied";

export interface RemoteControlRequest {
  requestId: string;
  binding: RemoteControlBinding;
  requestedAtMs: number;
  expiresAtMs: number;
}

export interface RemoteControlGrant {
  grantId: string;
  generation: number;
  binding: RemoteControlBinding;
  permissions: readonly ["pointer", "keyboard", "text"];
  issuedAtMs: number;
  /** Host monotonic time; null ends with this exact share/capture lifetime. */
  expiresAtMs: number | null;
}

export type RemoteControlInputEvent =
  | { kind: "pointer"; x: number; y: number }
  | { kind: "button"; button: RemoteControlMouseButton; pressed: boolean; x: number; y: number }
  | { kind: "wheel"; deltaX: number; deltaY: number; x: number; y: number }
  | { kind: "key"; code: string; pressed: boolean; repeat?: boolean }
  | { kind: "text"; text: string };

export interface RemoteControlInputEnvelope {
  grantId: string;
  generation: number;
  binding: RemoteControlBinding;
  /** Independently monotonic in reliable and lossy pointer lanes. */
  sequence: number;
  /** Controller translates its clock using host time samples; never compare wall clocks. */
  hostTimeMs: number;
  event: RemoteControlInputEvent;
}

export interface RemoteControlNativePoint {
  xPhysical: number;
  yPhysical: number;
  xDip: number;
  yDip: number;
  absoluteX: number;
  absoluteY: number;
}

export type RemoteControlNativeEvent =
  | ({ kind: "pointer" } & RemoteControlNativePoint)
  | ({
      kind: "button";
      button: RemoteControlMouseButton;
      pressed: boolean;
    } & RemoteControlNativePoint)
  | ({ kind: "wheel"; deltaX: number; deltaY: number } & RemoteControlNativePoint)
  | { kind: "key"; code: string; pressed: boolean; repeat: boolean }
  | { kind: "text"; text: string };

export interface RemoteControlNativeCommand {
  grantId: string;
  generation: number;
  event: RemoteControlNativeEvent;
}

export interface RemoteControlSnapshot {
  phase: RemoteControlPhase;
  requests: RemoteControlRequest[];
  grant?: RemoteControlGrant;
  reason?: string;
}

export type RemoteControlResult<T = undefined> =
  { ok: true; value: T } | { ok: false; reason: string };

export interface RemoteControlViewerGeometry {
  /** CSS/client coordinates of the visible viewer, including clipping. */
  viewport: RemoteControlRect;
  videoWidth: number;
  videoHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}
