import { isChannelCode, isPrivateRoomId } from "../types/private-room.types";
import { OFFICIAL_RELAY_SERVER_URL } from "../constants/app";

export const OFFICIAL_WEBSITE_URL =
  "https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com";

export interface PrivateRoomInvitation {
  roomId: string;
  channelCode: string;
  roomName: string;
  serverUrl?: string;
}

const invitationServer = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

const cleanName = (name: string): string =>
  Array.from(name)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .slice(0, 32);

export const parsePrivateRoomInvitation = (
  params: URLSearchParams,
): PrivateRoomInvitation | undefined => {
  const roomId = params.get("room");
  const channelCode = params.get("code");
  const serverUrl = invitationServer(params.get("server") ?? OFFICIAL_RELAY_SERVER_URL);
  if (!isPrivateRoomId(roomId) || !isChannelCode(channelCode) || !serverUrl) return undefined;
  return {
    roomId,
    channelCode,
    roomName: cleanName(params.get("name") ?? "私人房间"),
    serverUrl,
  };
};

export const privateRoomInvitationParams = (invite: PrivateRoomInvitation): URLSearchParams => {
  const serverUrl = invitationServer(invite.serverUrl ?? OFFICIAL_RELAY_SERVER_URL);
  if (!isPrivateRoomId(invite.roomId) || !isChannelCode(invite.channelCode) || !serverUrl)
    throw new Error("room_not_found");
  return new URLSearchParams({
    room: invite.roomId,
    code: invite.channelCode,
    name: cleanName(invite.roomName),
    action: "join",
    server: serverUrl,
  });
};

export const privateRoomInvitationUrl = (invite: PrivateRoomInvitation): string =>
  `${OFFICIAL_WEBSITE_URL}/join#${privateRoomInvitationParams(invite)}`;

export const privateRoomInvitationDeepLink = (invite: PrivateRoomInvitation): string =>
  `shanghao://join?${privateRoomInvitationParams(invite)}`;
