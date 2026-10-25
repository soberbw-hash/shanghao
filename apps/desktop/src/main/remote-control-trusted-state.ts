import type { AuthenticatedMembership } from "./signaling-membership";
import type { RemoteControlHostState } from "./remote-control-session";
import type { RemoteControlMemberIdentity } from "../../../../packages/shared/src/types/remote-control.types";
import type {
  HostShareInfo,
  RemoteControlNativeCapabilities,
} from "../../../../packages/shared/src/types/remote-control-service.types";
import { sameRemoteIdentity } from "./remote-control-controller";

/** Only Main capture ownership and authenticated signaling membership enter this adapter. */
export class RemoteControlTrustedState {
  constructor(
    private readonly readHost: () => RemoteControlHostState,
    private readonly readMembership: () => AuthenticatedMembership | undefined,
    private readonly capabilities: () => RemoteControlNativeCapabilities | undefined,
  ) {}
  membership(): AuthenticatedMembership {
    const membership = this.readMembership();
    if (
      !membership ||
      membership.members.length > 5 ||
      !membership.members.some((member) => sameRemoteIdentity(member, membership.host))
    )
      throw new Error("membership-unavailable");
    return membership;
  }
  peer(peerId: string): RemoteControlMemberIdentity | undefined {
    try {
      const membership = this.membership();
      return membership.members.find(
        (member) => member.peerId === peerId && !sameRemoteIdentity(member, membership.host),
      );
    } catch {
      return undefined;
    }
  }
  host(): RemoteControlHostState {
    const membership = this.membership(),
      host = this.readHost(),
      capability = this.capabilities();
    if (host.roomId !== membership.roomId || !sameRemoteIdentity(host.host, membership.host))
      throw new Error("host-membership-mismatch");
    return {
      ...host,
      host: membership.host,
      members: membership.members,
      inputSupported: host.inputSupported && capability?.supported === true && !capability.dryRun,
      emergencyStopReady: capability?.emergencyStopReady === true,
    };
  }
  shareInfo(): HostShareInfo | null {
    const host = this.readHost(),
      membership = this.membership(),
      share = host.share;
    if (
      !share ||
      !host.roomActive ||
      !host.connected ||
      host.roomId !== membership.roomId ||
      !sameRemoteIdentity(host.host, membership.host)
    )
      return null;
    return {
      roomId: membership.roomId,
      shareSessionId: share.shareSessionId,
      captureHandle: share.captureHandle,
      displayId: share.displayId,
      geometryVersion: share.geometryVersion,
      owner: membership.host,
      kind: share.kind,
      width: share.displayBoundsPhysical.width,
      height: share.displayBoundsPhysical.height,
      requestable:
        share.kind === "screen" && host.inputSupported && host.permissionGranted && !host.locked,
    };
  }
}
