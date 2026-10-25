import type { TemporaryIdentityStore } from "./temporary-identity-store";
import { TemporaryRoomClient, type TemporaryRoomRouter } from "./temporary-room-client";
import type { TemporaryLanDiscovery } from "./temporary-lan-discovery";
import { readPinnedLanCertificate } from "./temporary-lan-certificate";
import type { TemporaryLanHost, TemporaryRoomRoute } from "./temporary-lan-host";
import {
  TemporaryInternetConnection,
  type TemporaryInternetEndpoint,
} from "./temporary-internet-connection";
import {
  verifyInternetRegistration,
  type SignedInternetRegistration,
} from "../../../../packages/signaling/src/temporary-internet-protocol";

/** Main-only routing. A LAN broadcast never grants admission or supplies reusable credentials. */
export function createTemporaryRoomRouter(options: {
  identity: TemporaryIdentityStore;
  discovery: TemporaryLanDiscovery;
  host: TemporaryLanHost;
  endpoint: () => string;
  internetEndpoint?: () => TemporaryInternetEndpoint;
  onDiagnostic?: (code: string) => void;
}): TemporaryRoomRouter {
  options.host.configureInternet?.(options.internetEndpoint ?? options.endpoint);
  const locatePublic = async (code: string): Promise<TemporaryRoomRoute | undefined> => {
    const configured = options.internetEndpoint?.() ?? { url: options.endpoint().trim() };
    if (!configured.url) return;
    const connection = new TemporaryInternetConnection(options.identity, configured);
    try {
      const signed = (await connection.request("lookup", {
        code,
      })) as SignedInternetRegistration | null;
      if (!signed) return;
      if (!verifyInternetRegistration(signed) || signed.payload.code !== code)
        throw Error("temporary_bridge_registration_invalid");
      const p = signed.payload;
      return {
        url: configured.url,
        bridge: {
          broker: configured,
          sessionId: p.sessionId,
          deviceId: p.authorityId,
          registration: signed,
        },
        expected: { sessionId: p.sessionId, authorityId: p.authorityId, epoch: p.epoch },
      };
    } finally {
      connection.close();
    }
  };
  const locate = async (code: string): Promise<TemporaryRoomRoute | undefined> => {
    await options.discovery.start();
    const routes = new Map<string, TemporaryRoomRoute>();
    const found = await options.discovery.lookup(code, async (candidate, normalized, signal) => {
      const certificate = await readPinnedLanCertificate(
        candidate.endpoint,
        candidate.certificateSha256,
        signal,
      );
      if (signal?.aborted) throw Error("temporary_discovery_cancelled");
      const route = { url: `${candidate.endpoint}/temporary`, certificate };
      const client = new TemporaryRoomClient(options.identity, () => route.url);
      const abort = () => client.close();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const resolved = await client.resolveAt(route, normalized);
        routes.set(candidate.endpoint, { ...route, expected: resolved });
        return resolved;
      } finally {
        signal?.removeEventListener("abort", abort);
        client.close();
      }
    });
    return found ? routes.get(found.endpoint) : undefined;
  };
  return {
    joined: (route, room) => options.host.joined(route, room),
    recover: (room) => options.host.replication.recover(room),
    left: (sessionId) => options.host.left(sessionId),
    onConnectivity: (listener) => options.host.onConnectivity(listener),
    async resolve(code) {
      if (code) {
        const [lanResult, publicResult] = await Promise.allSettled([
          locate(code),
          locatePublic(code),
        ]);
        if (
          lanResult.status === "rejected" &&
          /ambiguous|authority_conflict/.test(String(lanResult.reason))
        )
          throw lanResult.reason;
        const lan = lanResult.status === "fulfilled" ? lanResult.value : undefined;
        const internet = publicResult.status === "fulfilled" ? publicResult.value : undefined;
        if (lan && internet) {
          if (lan.expected!.sessionId !== internet.expected!.sessionId)
            throw Error("temporary_lan_code_ambiguous");
          if (
            lan.expected!.epoch === internet.expected!.epoch &&
            lan.expected!.authorityId !== internet.expected!.authorityId
          )
            throw Error("temporary_lan_authority_conflict");
          return lan.expected!.epoch >= internet.expected!.epoch ? lan : internet;
        }
        if (lan) return lan;
        if (internet) return internet;
        if (publicResult.status === "rejected")
          options.onDiagnostic?.("temporary_internet_bridge_unavailable");
      }
      if (!code) return options.host.start();
      const endpoint = options.endpoint().trim();
      if (!endpoint) {
        if (code) throw Error("temporary_room_not_found");
        return options.host.start();
      }
      return { url: endpoint };
    },
    async fallback(error, code) {
      // Invalid identity, full/locked/missing rooms and protocol errors must not silently create another room.
      if (!/^Error: temporary_connection_(failed|timeout|closed)$/.test(String(error)))
        return undefined;
      if (!code) return options.host.start();
      return locate(code);
    },
  };
}
