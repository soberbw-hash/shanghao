import type { RemoteControlLane } from "@private-voice/shared/types/remote-control.types";
import type { RemoteControlWireMessage } from "@private-voice/shared/types/remote-control-service.types";

export type RemoteControlMessage = RemoteControlWireMessage;

const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).every((key) => names.includes(key));
const id = (v: unknown) => typeof v === "string" && /^[\w:.-]{1,160}$/.test(v);
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.length > 0 &&
  [...v].length <= max &&
  [...v].every((c) => {
    const cp = c.codePointAt(0)!;
    return (cp === 9 || cp === 10 || (cp >= 32 && cp !== 127)) && (cp < 0xd800 || cp > 0xdfff);
  });
const identity = (v: unknown) =>
  object(v) &&
  exact(v, ["peerId", "memberSessionId", "memberGeneration", "deviceId"]) &&
  id(v.peerId) &&
  id(v.memberSessionId) &&
  integer(v.memberGeneration) &&
  id(v.deviceId);
const binding = (v: unknown) =>
  object(v) &&
  exact(v, [
    "roomId",
    "shareSessionId",
    "captureHandle",
    "displayId",
    "geometryVersion",
    "target",
    "controller",
  ]) &&
  id(v.roomId) &&
  id(v.shareSessionId) &&
  id(v.captureHandle) &&
  id(v.displayId) &&
  integer(v.geometryVersion) &&
  identity(v.target) &&
  identity(v.controller);
const point = (v: Record<string, unknown>) =>
  number(v.x) && number(v.y) && (v.x as number) <= 1 && (v.y as number) <= 1;

function event(v: unknown, lane: RemoteControlLane): boolean {
  if (!object(v)) return false;
  if (lane === "pointer") return v.kind === "pointer" && exact(v, ["kind", "x", "y"]) && point(v);
  switch (v.kind) {
    case "button":
      return (
        exact(v, ["kind", "button", "pressed", "x", "y"]) &&
        ["left", "right", "middle"].includes(String(v.button)) &&
        typeof v.pressed === "boolean" &&
        point(v)
      );
    case "wheel":
      return (
        exact(v, ["kind", "deltaX", "deltaY", "x", "y"]) &&
        point(v) &&
        [v.deltaX, v.deltaY].every(
          (x) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1200,
        )
      );
    case "key":
      return (
        exact(v, ["kind", "code", "pressed", "repeat"]) &&
        typeof v.code === "string" &&
        /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(v.code) &&
        typeof v.pressed === "boolean" &&
        (v.repeat === undefined || typeof v.repeat === "boolean")
      );
    case "text":
      return exact(v, ["kind", "text"]) && text(v.text, 128);
    default:
      return false;
  }
}

/** Transport shape checks are not a control grant. Main must verify the binding and lease. */
export function validRemoteControlMessage(
  v: unknown,
  lane: RemoteControlLane,
): v is RemoteControlMessage {
  if (!object(v) || v.v !== 1) return false;
  if (v.type === "input") {
    const p = v.input;
    return (
      exact(v, ["v", "type", "input"]) &&
      object(p) &&
      exact(p, ["grantId", "generation", "binding", "sequence", "hostTimeMs", "event"]) &&
      id(p.grantId) &&
      integer(p.generation) &&
      binding(p.binding) &&
      integer(p.sequence) &&
      (p.sequence as number) > 0 &&
      number(p.hostTimeMs) &&
      event(p.event, lane)
    );
  }
  if (lane !== "reliable") return false;
  if (v.type === "share-info") {
    const p = v.share;
    return (
      exact(v, ["v", "type", "share"]) &&
      (p === null ||
        (object(p) &&
          exact(p, [
            "roomId",
            "shareSessionId",
            "captureHandle",
            "displayId",
            "geometryVersion",
            "owner",
            "kind",
            "width",
            "height",
            "requestable",
          ]) &&
          id(p.roomId) &&
          id(p.shareSessionId) &&
          id(p.captureHandle) &&
          id(p.displayId) &&
          integer(p.geometryVersion) &&
          Number(p.geometryVersion) > 0 &&
          identity(p.owner) &&
          (p.kind === "screen" || p.kind === "window") &&
          number(p.width) &&
          Number(p.width) > 0 &&
          Number(p.width) <= 32768 &&
          number(p.height) &&
          Number(p.height) > 0 &&
          Number(p.height) <= 32768 &&
          typeof p.requestable === "boolean"))
    );
  }
  if (v.type === "request-control")
    return (
      exact(v, ["v", "type", "requestId", "shareSessionId"]) &&
      id(v.requestId) &&
      id(v.shareSessionId)
    );
  if (v.type === "cancel") return exact(v, ["v", "type", "requestId"]) && id(v.requestId);
  if (v.type === "pause")
    return (
      exact(v, ["v", "type", "grantId", "generation"]) && id(v.grantId) && integer(v.generation)
    );
  if (v.type === "clock-request")
    return (
      exact(v, ["v", "type", "nonce", "controllerTimeMs"]) &&
      id(v.nonce) &&
      number(v.controllerTimeMs)
    );
  if (v.type === "clock-response")
    return (
      exact(v, ["v", "type", "nonce", "controllerTimeMs", "hostTimeMs"]) &&
      id(v.nonce) &&
      number(v.controllerTimeMs) &&
      number(v.hostTimeMs)
    );
  if (v.type === "deny")
    return exact(v, ["v", "type", "requestId", "reason"]) && id(v.requestId) && text(v.reason, 160);
  if (v.type === "revoke")
    return (
      exact(v, ["v", "type", "grantId", "generation", "reason"]) &&
      id(v.grantId) &&
      integer(v.generation) &&
      text(v.reason, 160)
    );
  if (v.type === "request") {
    const p = v.request;
    return (
      exact(v, ["v", "type", "request"]) &&
      object(p) &&
      exact(p, ["requestId", "binding", "requestedAtMs", "expiresAtMs"]) &&
      id(p.requestId) &&
      binding(p.binding) &&
      number(p.requestedAtMs) &&
      number(p.expiresAtMs) &&
      (p.expiresAtMs as number) > (p.requestedAtMs as number)
    );
  }
  if (v.type === "grant") {
    const p = v.grant;
    return (
      exact(v, ["v", "type", "grant"]) &&
      object(p) &&
      exact(p, ["grantId", "generation", "binding", "permissions", "issuedAtMs", "expiresAtMs"]) &&
      id(p.grantId) &&
      integer(p.generation) &&
      binding(p.binding) &&
      number(p.issuedAtMs) &&
      (p.expiresAtMs === null ||
        (number(p.expiresAtMs) && (p.expiresAtMs as number) > (p.issuedAtMs as number))) &&
      Array.isArray(p.permissions) &&
      p.permissions.length === 3 &&
      p.permissions[0] === "pointer" &&
      p.permissions[1] === "keyboard" &&
      p.permissions[2] === "text"
    );
  }
  return false;
}
