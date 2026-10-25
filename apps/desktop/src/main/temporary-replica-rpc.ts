import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  TEMPORARY_AUTH_AUDIENCE,
  type TemporaryAuthChallenge,
} from "../../../../packages/shared/src/types/temporary-room.types";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
import type { TemporaryRoomRoute } from "./temporary-lan-host";
import { openInternetRoomSocket } from "./temporary-internet-connection";

/** A short-lived Main-only RPC; both TLS pin and fresh session-bound device proof are mandatory. */
export async function temporaryReplicaRpc(
  identity: TemporaryIdentityStore,
  route: TemporaryRoomRoute,
  sessionId: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if ((!route.certificate && !route.bridge) || new URL(route.url).protocol !== "wss:")
    throw Error("temporary_replica_secure_endpoint_required");
  const trust = { ca: route.certificate, servername: "shanghao.local", rejectUnauthorized: true };
  const socket = route.bridge
    ? await openInternetRoomSocket(identity, route.bridge, signal)
    : new WebSocket(route.url, {
        ...trust,
        handshakeTimeout: 1500,
        maxPayload: 2 * 1024 * 1024,
      });
  const pending = new Map<string, { resolve: (x: unknown) => void; reject: (e: Error) => void }>();
  const abort = () => socket.terminate();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 3500);
  const rpc = (data: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const requestId = randomUUID();
      pending.set(requestId, { resolve, reject });
      socket.send(
        JSON.stringify({
          type: "temporary_room_request",
          version: 1,
          purpose: "replica",
          requestId,
          ...data,
        }),
      );
    });
  socket.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type !== "temporary_room_response" || m.version !== 1) return;
      const p = pending.get(m.requestId);
      if (!p) return;
      pending.delete(m.requestId);
      if (m.ok === true) p.resolve(m.value);
      else
        p.reject(
          Error(/^temporary_[a-z_]+$/.test(m.code) ? m.code : "temporary_replica_request_failed"),
        );
    } catch {
      socket.terminate();
    }
  });
  socket.on("close", () => {
    for (const p of pending.values()) p.reject(Error("temporary_replica_connection_closed"));
    pending.clear();
  });
  socket.on("error", () => undefined);
  try {
    if (signal?.aborted) throw Error("temporary_replica_cancelled");
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", () => reject(Error("temporary_replica_connection_failed")));
      socket.once("close", () => reject(Error("temporary_replica_connection_closed")));
    });
    const profile = await identity.getProfile();
    if (!profile) throw Error("temporary_profile_required");
    const challenge = (await rpc({
      command: "challenge",
      publicKey: profile.publicKey,
      sessionId,
    })) as TemporaryAuthChallenge;
    const proof = await identity.signChallenge(challenge, {
      audience: TEMPORARY_AUTH_AUDIENCE,
      sessionId,
    });
    return await rpc({ command: "replica", proof, value });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    socket.terminate();
  }
}
