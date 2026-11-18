import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";
import type { RoomClient } from "../room/roomClient";

/** Resolve the current live room at publish time, including across dev hot updates. */
export async function publishRoomScreenShare(
  clientRef: { current: RoomClient | null },
  stream: MediaStream,
  profile?: ScreenShareEncodingProfile,
): Promise<void> {
  const client = clientRef.current;
  if (!client) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("room_not_connected");
  }
  await client.startScreenShare(stream, profile);
}
