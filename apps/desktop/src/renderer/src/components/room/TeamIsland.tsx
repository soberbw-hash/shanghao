import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";
import { Music2 } from "lucide-react";

import {
  type BuiltInAvatarId,
  type ActiveQuickMusic,
  type MemberActivity,
  type RoomCollectionItem,
  type RoomMember,
  type SceneReaction,
  type SceneZoneId,
} from "@private-voice/shared";

import { getStableAvatarId } from "../../utils/profile";
import { motionEase } from "../../features/motion/motionSystem";
import { SceneExitDoor, SceneWallClock } from "./SceneAmbientDecor";
import { DynamicWeatherWindow } from "./DynamicWeatherWindow";
import { RoomDateCalendar } from "./RoomDateCalendar";
import type { RoomCollectionDragPayload } from "../../features/chat/collectionDrag";
import { RoomCollectionShelf } from "./RoomCollectionShelf";
import { SceneCharacter, type SceneCharacterQuickMessage } from "./SceneCharacter";
import { sceneMemberKey } from "./sceneMemberKey";
import { GameMonitorContent } from "./GameMonitorContent";
import { MusicActivityBadge } from "./MusicActivityBadge";
import { WorkstationArt } from "./WorkstationArt";
import { IdleMonitorContent } from "./IdleMonitorContent";
import {
  characterPositions,
  isSeatZone,
  resolveMemberSceneZones,
  sceneZones,
  seatSlots,
} from "../../features/voice-scene/sceneZones";
import { memberStatus } from "../../features/voice-scene/activityRules";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useVisibleInterval } from "../../hooks/useVisualVisibility";
import type { ConnectionQualityLevel } from "../../features/network/networkDiagnostics";
import { useSettingsStore } from "../../store/settingsStore";
import { useAppStore } from "../../store/appStore";
import { useWeatherStore } from "../../features/weather/weatherStore";
import { resolveWeatherVisualTheme } from "../../features/weather/weatherTheme";
import { roomAnimationScheduler } from "../../features/visual-runtime/RoomAnimationScheduler";
import { useCoordinatedIdleActions } from "../../features/voice-scene/useCoordinatedIdleActions";
import {
  defaultRoomSceneManifest,
  sceneFeatureRegistry,
} from "../../features/visual-runtime/sceneFeatureRegistry";

const EXITED_MEMBER_CLEANUP_FALLBACK_MS = 5_000;

const uniqueVisibleMembers = (members: RoomMember[]): RoomMember[] => {
  const byStableIdentity = new Map<string, RoomMember>();
  for (const member of members) {
    if (member.isEmptySlot) continue;
    const key = sceneMemberKey(member);
    const existing = byStableIdentity.get(key);
    if (!existing || member.joinedAt >= existing.joinedAt) {
      byStableIdentity.set(key, member);
    }
  }
  return [...byStableIdentity.values()].slice(0, 5);
};

const assignVisibleAvatars = (members: RoomMember[]): Map<string, BuiltInAvatarId> => {
  return new Map(
    members.map((member) => [member.id, getStableAvatarId(member.id, member.avatarId)]),
  );
};

export const TeamIsland = ({
  members,
  onZoneSelect,
  onReact,
  onVolumeChange,
  screenSharingPeerIds = [],
  networkQuality = "pending",
  reactions = [],
  chatBubbles = [],
  knockPulse = 0,
  collectionItems = [],
  isCollectionOpen = false,
  isCollectionDragOver = false,
  hasUnreadCollectionItems = false,
  onOpenCollection,
  onCollectionDragOverChange,
  onSaveDraggedCollection,
  activeQuickMusic,
  onMuteQuickMusic,
  reduceMotion = false,
  pauseVisualMotion = false,
}: {
  members: RoomMember[];
  onZoneSelect?: (zone: SceneZoneId, activity: MemberActivity) => void;
  onReact?: (targetPeerId: string, emoji: SceneReaction["emoji"]) => void;
  onVolumeChange?: (memberId: string, volume: number) => void;
  screenSharingPeerIds?: string[];
  networkQuality?: ConnectionQualityLevel;
  reactions?: SceneReaction[];
  chatBubbles?: Array<SceneCharacterQuickMessage & { peerId: string }>;
  knockPulse?: number;
  collectionItems?: RoomCollectionItem[];
  isCollectionOpen?: boolean;
  isCollectionDragOver?: boolean;
  hasUnreadCollectionItems?: boolean;
  onOpenCollection?: () => void;
  onCollectionDragOverChange?: (value: boolean) => void;
  onSaveDraggedCollection?: (payload: RoomCollectionDragPayload) => void;
  activeQuickMusic?: ActiveQuickMusic;
  onMuteQuickMusic?: (playback: ActiveQuickMusic) => void;
  reduceMotion?: boolean;
  pauseVisualMotion?: boolean;
}) => {
  const islandRef = useRef<HTMLDivElement>(null);
  const isDynamicWeatherEnabled = useSettingsStore(
    (state) => state.settings?.isDynamicWeatherEnabled,
  );
  const weatherLocationMode = useSettingsStore((state) => state.settings?.weatherLocationMode);
  const weatherManualCity = useSettingsStore((state) => state.settings?.weatherManualCity);
  const isRoomPageObscured = useAppStore((state) => state.currentPage === "settings");
  const weatherSnapshot = useWeatherStore((state) => state.snapshot);
  const weatherPreview = useWeatherStore((state) => state.preview);
  const weatherTheme = resolveWeatherVisualTheme(
    isDynamicWeatherEnabled
      ? weatherPreview
        ? {
            ...weatherSnapshot,
            ...weatherPreview,
            fetchedAt: weatherSnapshot?.fetchedAt ?? "",
            expiresAt: weatherSnapshot?.expiresAt ?? "",
            source: weatherSnapshot?.source ?? "fallback",
          }
        : weatherSnapshot
      : undefined,
  );
  const weatherRoomClass =
    isDynamicWeatherEnabled === false
      ? "weather-room-default"
      : `weather-room-${weatherTheme.roomTone} weather-room-phase-${weatherTheme.phase}`;
  // A reconnect replaces the transport peer id but keeps the account/profile id.
  // Collapse the brief old/new snapshot overlap so React never paints two copies
  // of the same person while the old peer is still running its exit route.
  const visibleMembers = uniqueVisibleMembers(members);
  const visibleAvatars = assignVisibleAvatars(visibleMembers);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);
  const [ambient, setAmbient] = useState<"day" | "evening" | "night">("day");
  const [hoveredZone, setHoveredZone] = useState<SceneZoneId>();
  const [welcomingMemberIds, setWelcomingMemberIds] = useState<Set<string>>(new Set());
  const [settledMemberZones, setSettledMemberZones] = useState<Record<string, SceneZoneId>>({});
  const memberSnapshotsRef = useRef(new Map<string, RoomMember>());
  const memberZoneSnapshotsRef = useRef(new Map<string, SceneZoneId>());
  const visibleMemberIdsRef = useRef(new Set<string>());
  const previousMemberIdsRef = useRef<string[] | undefined>(undefined);
  // Transport ids intentionally stay in this signature: a fast reconnect keeps
  // the stable React key but must still trigger stale seat/snapshot cleanup.
  const memberSignature = visibleMembers.map((member) => member.id).join("|");
  const screenSharingSet = new Set(screenSharingPeerIds);
  const chatBubbleByPeerId = new Map(
    chatBubbles.map((message) => [message.peerId, message] as const),
  );
  visibleMemberIdsRef.current = new Set(visibleMembers.map((member) => member.id));
  visibleMembers.forEach((member) => memberSnapshotsRef.current.set(member.id, member));
  const visibleMemberById = new Map(visibleMembers.map((member) => [member.id, member] as const));
  const reservedSeatIds = new Set<SceneZoneId>(
    Object.entries(settledMemberZones)
      .filter(([memberId, zone]) => !visibleMemberById.has(memberId) && isSeatZone(zone))
      .map(([, zone]) => zone),
  );
  memberZoneSnapshotsRef.current.forEach((zone, memberId) => {
    if (!visibleMemberById.has(memberId) && isSeatZone(zone)) reservedSeatIds.add(zone);
  });
  const resolvedMemberZones = resolveMemberSceneZones(visibleMembers, reservedSeatIds);
  visibleMembers.forEach((member) => {
    const zone = resolvedMemberZones.get(member.id);
    if (zone) memberZoneSnapshotsRef.current.set(member.id, zone);
  });
  const occupiedSeatIds = new Set<SceneZoneId>();
  visibleMembers.forEach((member) => {
    const zone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
    if (isSeatZone(zone)) occupiedSeatIds.add(zone);
  });
  const memberBySeat = new Map(
    visibleMembers
      .map((member) => [resolvedMemberZones.get(member.id), member] as const)
      .filter((entry): entry is readonly [SceneZoneId, RoomMember] =>
        Boolean(entry[0] && isSeatZone(entry[0])),
      ),
  );
  const settledMemberBySeat = new Map(
    Object.entries(settledMemberZones)
      .map(
        ([memberId, zone]) =>
          [
            zone,
            visibleMemberById.get(memberId) ?? memberSnapshotsRef.current.get(memberId),
          ] as const,
      )
      .filter(
        (entry): entry is readonly [SceneZoneId, RoomMember] =>
          isSeatZone(entry[0]) && Boolean(entry[1]),
      ),
  );
  const localMember = visibleMembers.find((member) => member.isLocal);
  const localZone = localMember ? resolvedMemberZones.get(localMember.id) : undefined;
  const localSettledZone = localMember
    ? (settledMemberZones[localMember.id] ?? localZone)
    : undefined;
  const isCharacterMotionActive = visibleMembers.some((member) => {
    const settledZone = settledMemberZones[member.id];
    const targetZone = resolvedMemberZones.get(member.id);
    // A newly mounted character is moving until it reports its first settled zone.
    // Pause decorative animation during room entry as well as later seat changes.
    return targetZone !== undefined && settledZone !== targetZone;
  });
  const shouldPauseVisualMotion = pauseVisualMotion || isRoomPageObscured;
  const shouldPauseAmbientMotion = shouldPauseVisualMotion || isCharacterMotionActive;
  const coordinatedIdleActions = useCoordinatedIdleActions(
    visibleMembers.map((member) => {
      const memberZone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
      const tone = memberStatus(member).tone;
      return {
        id: member.id,
        avatarId: visibleAvatars.get(member.id) ?? "fox",
        eligible:
          isSeatZone(memberZone) &&
          settledMemberZones[member.id] === memberZone &&
          !screenSharingSet.has(member.id) &&
          !member.gameName &&
          member.activity !== "gaming" &&
          !["speaking", "reconnecting", "offline"].includes(tone),
      };
    }),
    shouldReduceMotion || shouldPauseAmbientMotion,
  );
  const awayMembers = visibleMembers.filter(
    (member) => resolvedMemberZones.get(member.id) === "restroomZone",
  );
  const handleMemberSettled = useCallback((memberId: string, zone: SceneZoneId) => {
    roomAnimationScheduler.enqueue({
      key: `member-settled:${memberId}`,
      write: () => {
        setSettledMemberZones((current) =>
          current[memberId] === zone ? current : { ...current, [memberId]: zone },
        );
      },
    });
  }, []);

  const handleMemberExited = useCallback((memberId: string) => {
    roomAnimationScheduler.enqueue({
      key: `member-exited:${memberId}`,
      write: () => {
        // A quick reconnect can make the same member visible again before the
        // exit animation finishes. In that case the exit callback must not
        // delete the reconnected member's settled position.
        if (visibleMemberIdsRef.current.has(memberId)) return;
        memberSnapshotsRef.current.delete(memberId);
        memberZoneSnapshotsRef.current.delete(memberId);
        setSettledMemberZones((current) => {
          if (!(memberId in current)) return current;
          const next = { ...current };
          delete next[memberId];
          return next;
        });
      },
    });
  }, []);

  const wallFeatures = defaultRoomSceneManifest.composition;

  useEffect(() => {
    const staleMemberIds = [...memberZoneSnapshotsRef.current.keys()].filter(
      (memberId) => !visibleMemberIdsRef.current.has(memberId),
    );
    if (staleMemberIds.length === 0) return;

    // SceneCharacter normally removes these snapshots after its exit route.
    // A renderer interruption or a cancelled presence animation must not leave
    // an invisible member reserving a clickable seat forever.
    const timer = window.setTimeout(() => {
      roomAnimationScheduler.enqueue({
        key: `stale-member-cleanup:${staleMemberIds.join(":")}`,
        write: () => {
          const removableIds = staleMemberIds.filter(
            (memberId) => !visibleMemberIdsRef.current.has(memberId),
          );
          if (removableIds.length === 0) return;
          removableIds.forEach((memberId) => {
            memberSnapshotsRef.current.delete(memberId);
            memberZoneSnapshotsRef.current.delete(memberId);
          });
          setSettledMemberZones((current) => {
            const next = { ...current };
            let changed = false;
            removableIds.forEach((memberId) => {
              if (!(memberId in next)) return;
              delete next[memberId];
              changed = true;
            });
            return changed ? next : current;
          });
        },
      });
    }, EXITED_MEMBER_CLEANUP_FALLBACK_MS);

    return () => window.clearTimeout(timer);
  }, [memberSignature]);

  useEffect(() => {
    const currentIds = memberSignature ? memberSignature.split("|") : [];
    const previousIds = previousMemberIdsRef.current;
    previousMemberIdsRef.current = currentIds;
    if (!previousIds?.length || !currentIds.some((id) => !previousIds.includes(id))) return;

    const stillPresent = previousIds.filter((id) => currentIds.includes(id));
    setWelcomingMemberIds(new Set(stillPresent));
    const timer = window.setTimeout(() => setWelcomingMemberIds(new Set()), 1_650);
    return () => window.clearTimeout(timer);
  }, [memberSignature]);

  useVisibleInterval(() => {
    const hour = new Date().getHours();
    setAmbient(hour >= 22 || hour < 6 ? "night" : hour >= 18 ? "evening" : "day");
  }, 60_000);

  useLayoutEffect(() => {
    if (shouldReduceMotion || !islandRef.current || knockPulse <= 0) return;
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { overwrite: true } });
      timeline
        .fromTo(
          "[data-knock-wave]",
          { autoAlpha: 0.48, scale: 0.48 },
          { autoAlpha: 0, scale: 2.4, duration: 0.52, ease: motionEase.spatial },
          0,
        )
        .to(
          ".scene-workstation .scene-workstation-art-frame",
          {
            keyframes: [
              { x: -6, y: -4, rotation: -1.3, duration: 0.05 },
              { x: 6, y: 2.5, rotation: 1.45, duration: 0.06 },
              { x: -4, y: -2, rotation: -0.9, duration: 0.055 },
              { x: 3, y: 1, rotation: 0.5, duration: 0.055 },
              { x: 0, y: 0, rotation: 0, duration: 0.13 },
            ],
            transformOrigin: "50% 82%",
            ease: motionEase.feedback,
            stagger: { each: 0.03, from: "center" },
          },
          0.015,
        )
        .to(
          ".scene-workstation .scene-workstation-screen",
          {
            keyframes: [
              { scale: 1.075, filter: "brightness(1.34)", duration: 0.07 },
              { scale: 0.975, filter: "brightness(1.08)", duration: 0.08 },
              { scale: 1, filter: "brightness(1)", duration: 0.12 },
            ],
            transformOrigin: "50% 60%",
            stagger: { each: 0.022, from: "center" },
          },
          0.025,
        )
        .to(
          ".scene-workstation .scene-desk-shadow",
          {
            keyframes: [
              { scaleX: 1.16, opacity: 0.58, duration: 0.08 },
              { scaleX: 1, opacity: 1, duration: 0.18 },
            ],
            stagger: { each: 0.022, from: "center" },
          },
          0.03,
        )
        .to(
          "[data-gsap-character] .desk-animal",
          {
            keyframes: [
              { y: -5, rotation: -1.8, scale: 1.025, duration: 0.07 },
              { y: 1, rotation: 1.2, scale: 0.995, duration: 0.08 },
              { y: 0, rotation: 0, scale: 1, duration: 0.16 },
            ],
            transformOrigin: "50% 100%",
            stagger: { each: 0.028, from: "center" },
          },
          0.055,
        )
        .set(
          ".scene-workstation-art-frame, .scene-workstation-screen, .scene-desk-shadow, [data-gsap-character] .desk-animal",
          { clearProps: "transform,filter,opacity" },
        );
    }, islandRef);
    return () => context.revert();
  }, [knockPulse, shouldReduceMotion]);

  return (
    <div
      ref={islandRef}
      className={`team-island ambient-${ambient} ${weatherRoomClass} ${
        shouldPauseVisualMotion ? "is-visual-motion-paused" : ""
      } ${
        isCharacterMotionActive ? "is-character-motion-active" : ""
      } relative h-full min-h-[420px] overflow-hidden`}
      data-testid="team-island"
    >
      <span className="scene-knock-wave" data-knock-wave aria-hidden="true" />
      <div className="team-island-stage absolute inset-0" aria-hidden="true">
        <div className="scene-wall-backdrop" />
        <div className="scene-weather-ambient" />
        <div className="scene-window-light" />
        <div className="scene-rug" />
        <div className="scene-brand-arc" />
        {wallFeatures["wall-left"].includes("weather-window") &&
        sceneFeatureRegistry.has("weather-window") ? (
          <div className="scene-window-nook">
            <DynamicWeatherWindow
              isEnabled={isDynamicWeatherEnabled ?? true}
              locationMode={weatherLocationMode ?? "auto"}
              manualCity={weatherManualCity ?? ""}
            />
          </div>
        ) : null}
        {wallFeatures["wall-right"].includes("wall-clock") &&
        sceneFeatureRegistry.has("wall-clock") ? (
          <div className="scene-wall-clock">
            <SceneWallClock />
          </div>
        ) : null}
        <div
          className={`scene-service-zone scene-service-restroom ${
            hoveredZone === "restroomZone" ? "is-hovered" : ""
          } ${localZone === "restroomZone" ? "is-current" : ""}`}
        >
          <SceneExitDoor className="scene-exit-door" />
          <span className="scene-exit-label">离开</span>
        </div>
        {seatSlots.map((slot, slotIndex) => {
          const occupant = memberBySeat.get(slot.id);
          // Presence publishes the destination immediately. Keep the old desk display stable
          // until the character has physically completed the route away from that desk.
          const settledOccupant = settledMemberBySeat.get(slot.id);
          const occupantTone = occupant ? memberStatus(occupant).tone : undefined;
          const isScreenSharing = screenSharingSet.has(settledOccupant?.id ?? "");
          return (
            <div
              key={slot.id}
              className={`scene-workstation ${hoveredZone === slot.id ? "is-hovered" : ""} ${
                localSettledZone === slot.id ? "is-current" : ""
              } ${occupant ? "is-occupied" : ""} ${
                occupantTone === "reconnecting" ? "is-reconnecting" : ""
              }`}
              data-seat-zone={slot.id}
              style={{
                left: `${slot.left}%`,
                top: `${slot.top}%`,
                zIndex: characterPositions[slot.id].zIndex - 3,
              }}
            >
              <div className="scene-desk-shadow" />
              <div className="scene-workstation-art-frame">
                <WorkstationArt className="scene-workstation-art" />
                <span
                  className={`scene-workstation-screen ${settledOccupant ? "online" : ""} ${
                    settledOccupant?.gameName ? "gaming" : ""
                  } ${isScreenSharing ? "sharing" : ""} ${
                    networkQuality === "poor" && settledOccupant ? "network-unstable" : ""
                  }`}
                >
                  <AnimatePresence mode="sync" initial={false}>
                    {settledOccupant ? (
                      <motion.span
                        key={`${settledOccupant.id}:${slot.id}:${
                          isScreenSharing ? "sharing" : (settledOccupant.gameName ?? "idle")
                        }`}
                        className="scene-workstation-screen-content"
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {isScreenSharing ? (
                          <span className="scene-workstation-sharing-mark">共享中</span>
                        ) : settledOccupant.gameName ? (
                          <GameMonitorContent
                            gameName={settledOccupant.gameName}
                            iconDataUrl={settledOccupant.gameIconDataUrl}
                            shouldReduceMotion={shouldReduceMotion || shouldPauseAmbientMotion}
                          />
                        ) : (
                          <IdleMonitorContent
                            offsetSeconds={slotIndex * 48}
                            shouldReduceMotion={shouldReduceMotion || shouldPauseAmbientMotion}
                          />
                        )}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {wallFeatures["wall-center"].includes("date-calendar") &&
      sceneFeatureRegistry.has("date-calendar") ? (
        <RoomDateCalendar />
      ) : null}
      <RoomCollectionShelf
        items={collectionItems}
        isOpen={isCollectionOpen}
        isDragOver={isCollectionDragOver}
        hasUnreadItems={hasUnreadCollectionItems}
        onOpen={() => onOpenCollection?.()}
        onDragOverChange={(value) => onCollectionDragOverChange?.(value)}
        onSaveDragged={(payload) => onSaveDraggedCollection?.(payload)}
      />
      <div className="pointer-events-none absolute inset-0 z-[48]">
        {seatSlots.map((slot) => {
          const occupied = occupiedSeatIds.has(slot.id);
          return (
            <div
              key={slot.id}
              className={`scene-seat-marker ${occupied ? "occupied" : "empty"}`}
              style={{
                left: `${slot.left}%`,
                top: `${slot.top}%`,
              }}
              aria-hidden="true"
            >
              <span>{slot.shortLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0 z-[18]">
        {sceneZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`scene-zone-hotspot pointer-events-auto ${
              zone.kind === "seat" ? "seat" : "activity"
            } ${localZone === zone.id ? "current" : ""}`}
            style={{
              left: `${zone.left - zone.width / 2}%`,
              top: `${zone.top - zone.height / 2}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
            }}
            aria-label={`移动到${zone.label}`}
            disabled={zone.kind === "seat" && occupiedSeatIds.has(zone.id) && localZone !== zone.id}
            onPointerEnter={() => setHoveredZone(zone.id)}
            onPointerLeave={() =>
              setHoveredZone((current) => (current === zone.id ? undefined : current))
            }
            onFocus={() => setHoveredZone(zone.id)}
            onBlur={() => setHoveredZone((current) => (current === zone.id ? undefined : current))}
            onClick={() => onZoneSelect?.(zone.id, zone.activity)}
          >
            <span>{zone.label}</span>
          </button>
        ))}
      </div>

      <div className="music-activity-overlay pointer-events-none absolute inset-0 z-[62]">
        <AnimatePresence initial={false}>
          {seatSlots.map((slot) => {
            const occupant = memberBySeat.get(slot.id);
            const quickMusic =
              occupant && activeQuickMusic?.peerId === occupant.id ? activeQuickMusic : undefined;
            if (
              !occupant ||
              (!occupant.musicActivity && !quickMusic) ||
              settledMemberZones[occupant.id] !== slot.id
            )
              return null;
            return (
              <motion.div
                key={`${occupant.id}:${slot.id}`}
                className="music-activity-position"
                style={{ left: `${slot.left}%`, top: `${slot.top}%` }}
                initial={{ opacity: 0, scale: 0.82 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="activity-badge-stack" data-seat-zone={slot.id}>
                  {quickMusic ? (
                    <button
                      type="button"
                      className="quick-message-music-badge"
                      title={
                        occupant.isLocal
                          ? `停止本次音乐：${quickMusic.title}`
                          : `屏蔽${quickMusic.nickname}本次音乐`
                      }
                      aria-label={
                        occupant.isLocal ? "停止本次音乐" : `屏蔽${quickMusic.nickname}本次音乐`
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onMuteQuickMusic?.(quickMusic);
                      }}
                    >
                      <Music2 aria-hidden="true" />
                      <i aria-hidden="true" />
                    </button>
                  ) : null}
                  {occupant.musicActivity ? (
                    <MusicActivityBadge activity={occupant.musicActivity} />
                  ) : null}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {visibleMembers.map((member, memberIndex) => {
          const zone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
          const awayIndex = awayMembers.findIndex((candidate) => candidate.id === member.id);
          return (
            <SceneCharacter
              key={sceneMemberKey(member)}
              member={member}
              avatarId={visibleAvatars.get(member.id) ?? "fox"}
              shouldReduceMotion={shouldReduceMotion}
              awayIndex={Math.max(0, awayIndex)}
              awayCount={awayMembers.length}
              zone={zone}
              arrivalIndex={memberIndex}
              isWelcoming={welcomingMemberIds.has(member.id)}
              isScreenSharing={screenSharingSet.has(member.id)}
              idleAction={coordinatedIdleActions[member.id]}
              reactions={reactions
                .filter(
                  (reaction) =>
                    reaction.targetPeerId === member.id &&
                    Date.now() - Date.parse(reaction.createdAt) < 2_000,
                )
                .slice(-3)}
              chatBubble={chatBubbleByPeerId.get(member.id)}
              onReact={onReact}
              onVolumeChange={onVolumeChange}
              onSettled={handleMemberSettled}
              onExited={handleMemberExited}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
