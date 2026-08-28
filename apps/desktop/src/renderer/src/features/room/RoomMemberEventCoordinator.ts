import {
  MemberSpeakingState,
  type ChatMessage,
  type RoomCollectionItem,
  type RoomMember,
  type RoomQuickMessage,
  type SceneReaction,
} from "@private-voice/shared";
import type {
  AvatarUpdateMessage,
  KnockEventMessage,
  MemberStateMessage,
  RoomCollectionSnapshotMessage,
  SceneReactionMessage,
} from "@private-voice/signaling";

import {
  decodeQuickMessageControlTarget,
  decodeQuickMessageTarget,
  decodeQuickReplyTarget,
  presetForQuickReplyContent,
  type QuickMessageControlEvent,
} from "../chat/quickReplies";
import {
  normalizePresenceGameIconDataUrl,
  normalizePresenceGameName,
  resolvePresenceGameNameUpdate,
} from "./presenceSignal";

interface RoomMemberEventCoordinatorOptions {
  localPeerId: string;
  onMembers: (members: RoomMember[]) => void;
  onCollection: (items: RoomCollectionItem[], replace: boolean) => void;
  onKnock: (message: ChatMessage) => void;
  onReaction: (reaction: SceneReaction) => void;
  onQuickMessage: (message: RoomQuickMessage) => void;
  onQuickMessageControl?: (control: QuickMessageControlEvent) => void;
}

/** Applies member-facing signaling events to the single current-members snapshot. */
export class RoomMemberEventCoordinator {
  private members: RoomMember[] = [];
  private readonly avatars = new Map<string, { avatarHash?: string; avatarDataUrl?: string }>();

  constructor(private readonly options: RoomMemberEventCoordinatorOptions) {}

  get currentMembers(): RoomMember[] {
    return this.members;
  }

  setMembers(members: RoomMember[]): void {
    this.members = members;
  }

  updateLocalPresence(
    isDeafened: boolean,
    activity: RoomMember["activity"],
    sceneZone?: RoomMember["sceneZone"],
    gameName?: string,
    musicActivity?: RoomMember["musicActivity"],
    gameIconDataUrl?: string,
    workActivity?: RoomMember["workActivity"],
  ): void {
    this.members = this.members.map((member) => {
      if (member.id !== this.options.localPeerId) return member;
      const normalizedGameName = normalizePresenceGameName(gameName);
      return {
        ...member,
        isDeafened,
        activity,
        sceneZone,
        gameName: normalizedGameName,
        gameIconDataUrl: normalizePresenceGameIconDataUrl(normalizedGameName, gameIconDataUrl),
        musicActivity,
        workActivity,
      };
    });
  }

  getAvatar(peerId: string): { avatarHash?: string; avatarDataUrl?: string } | undefined {
    return this.avatars.get(peerId);
  }

  handleCollection(payload: RoomCollectionSnapshotMessage): void {
    this.options.onCollection(payload.items, payload.replace !== false);
  }

  handleKnock(payload: KnockEventMessage): void {
    this.options.onKnock({
      id: `knock-${payload.peerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      nickname: payload.nickname,
      content:
        payload.peerId === this.options.localPeerId ? "你敲了一下" : `${payload.nickname} 敲了一下`,
      createdAt: payload.createdAt,
      isLocal: payload.peerId === this.options.localPeerId,
      kind: "system",
    });
  }

  handleReaction(payload: SceneReactionMessage): void {
    const quickMessageControl = decodeQuickMessageControlTarget(payload.targetPeerId);
    if (quickMessageControl) {
      if (payload.peerId === this.options.localPeerId) return;
      this.options.onQuickMessageControl?.({
        ...quickMessageControl,
        peerId: payload.peerId,
        createdAt: payload.createdAt,
      });
      return;
    }
    const configuredPreset = decodeQuickMessageTarget(payload.targetPeerId);
    const legacyContent = decodeQuickReplyTarget(payload.targetPeerId);
    const preset =
      configuredPreset ?? (legacyContent ? presetForQuickReplyContent(legacyContent) : undefined);
    const quickContent = preset?.content ?? legacyContent;
    if (quickContent) {
      const author = this.members.find((member) => member.id === payload.peerId);
      this.options.onQuickMessage({
        id: `quick-${payload.peerId}-${payload.createdAt}`,
        peerId: payload.peerId,
        nickname: author?.nickname ?? "朋友",
        avatarId: author?.avatarId,
        content: quickContent,
        presetId: preset?.id,
        soundId: preset?.soundId,
        mediaType: preset?.mediaType,
        createdAt: payload.createdAt,
        isLocal: payload.peerId === this.options.localPeerId,
      });
      return;
    }
    this.options.onReaction({
      id: `${payload.peerId}-${payload.targetPeerId}-${payload.createdAt}`,
      peerId: payload.peerId,
      targetPeerId: payload.targetPeerId,
      emoji: payload.emoji,
      createdAt: payload.createdAt,
    });
  }

  handleMemberState(payload: MemberStateMessage): void {
    let changed = false;
    this.members = this.members.map((member) => {
      if (member.id !== payload.peerId) return member;
      changed = true;
      const isMuted = payload.isMuted ?? member.isMuted;
      const isSpeaking =
        payload.isSpeaking ?? member.speakingState === MemberSpeakingState.Speaking;
      const gameName = resolvePresenceGameNameUpdate(
        member.gameName,
        payload.gameName,
        payload.activity,
      );
      const incomingGameIconDataUrl =
        payload.gameIconDataUrl === null
          ? undefined
          : (payload.gameIconDataUrl ?? member.gameIconDataUrl);
      return {
        ...member,
        nickname: payload.nickname ?? member.nickname,
        avatarId: payload.avatarId ?? member.avatarId,
        isDeafened: payload.isDeafened ?? member.isDeafened,
        activity: payload.activity ?? member.activity,
        sceneZone: payload.sceneZone ?? member.sceneZone,
        gameName,
        gameIconDataUrl: normalizePresenceGameIconDataUrl(gameName, incomingGameIconDataUrl),
        musicActivity:
          payload.musicActivity === null
            ? undefined
            : (payload.musicActivity ?? member.musicActivity),
        workActivity:
          payload.workActivity === null ? undefined : (payload.workActivity ?? member.workActivity),
        isMuted,
        speakingState: isMuted
          ? MemberSpeakingState.Muted
          : isSpeaking
            ? MemberSpeakingState.Speaking
            : MemberSpeakingState.Silent,
      };
    });
    if (changed) this.options.onMembers(this.members);
  }

  handleAvatar(payload: AvatarUpdateMessage): void {
    if (!payload.avatarDataUrl) return;
    this.avatars.set(payload.peerId, {
      avatarHash: payload.avatarHash,
      avatarDataUrl: payload.avatarDataUrl,
    });
    let changed = false;
    this.members = this.members.map((member) => {
      if (member.id !== payload.peerId) return member;
      changed = true;
      return {
        ...member,
        avatarHash: payload.avatarHash,
        avatarDataUrl: payload.avatarDataUrl,
      };
    });
    if (changed) this.options.onMembers(this.members);
  }
}
