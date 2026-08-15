import {
  MAX_ROOM_COLLECTION_IMAGE_LENGTH,
  MAX_ROOM_COLLECTION_TEXT_LENGTH,
  type RoomCollectionItem,
  type SceneReaction,
} from "@private-voice/shared";
import type { SignalEnvelope } from "@private-voice/signaling";

interface RoomSocialTransportOptions {
  roomId: string;
  peerId: string;
  getNickname: () => string;
  canSend: () => boolean;
  send: (payload: SignalEnvelope) => Promise<void>;
}

/** Sends collection, knock and scene-reaction commands that accompany room chat. */
export class RoomSocialTransport {
  constructor(private readonly options: RoomSocialTransportOptions) {}

  async recall(messageId: string): Promise<void> {
    this.assertConnected();
    await this.options.send({ type: "chat_recall", roomId: this.options.roomId, messageId });
  }

  async addCollection(
    kind: RoomCollectionItem["kind"],
    title: string,
    content: string,
  ): Promise<void> {
    this.assertConnected();
    await this.options.send({
      type: "room_collection_add",
      roomId: this.options.roomId,
      kind,
      title: title.trim().slice(0, 80),
      content: content
        .trim()
        .slice(
          0,
          kind === "image" ? MAX_ROOM_COLLECTION_IMAGE_LENGTH : MAX_ROOM_COLLECTION_TEXT_LENGTH,
        ),
    });
  }

  async removeCollection(itemId: string): Promise<void> {
    this.assertConnected();
    await this.options.send({
      type: "room_collection_remove",
      roomId: this.options.roomId,
      itemId,
    });
  }

  async knock(): Promise<void> {
    this.assertConnected();
    await this.options.send({
      type: "knock_event",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      nickname: this.options.getNickname(),
      createdAt: new Date().toISOString(),
    });
  }

  async react(targetPeerId: string, emoji: SceneReaction["emoji"]): Promise<void> {
    this.assertConnected();
    await this.options.send({
      type: "scene_reaction",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId,
      emoji,
      createdAt: new Date().toISOString(),
    });
  }

  private assertConnected(): void {
    if (!this.options.canSend()) throw new Error("signaling_not_connected");
  }
}
