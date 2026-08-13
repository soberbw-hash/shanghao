import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Fish } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";

import {
  type BuiltInAvatarId,
  type MemberActivity,
  type RoomMember,
  type SceneReaction,
  type SceneZoneId,
} from "@private-voice/shared";

import { getStableAvatarId } from "../../utils/profile";
import { motionEase } from "../../features/motion/motionSystem";
import {
  SceneFloorLamp,
  SceneExitDoor,
  SceneLowTable,
  SceneTallPlant,
  SceneWallClock,
  SceneWallShelf,
  SceneWindowNook,
} from "./SceneAmbientDecor";
import { SceneCharacter, sceneMemberKey, type SceneCharacterQuickMessage } from "./SceneCharacter";
import { GameMonitorContent } from "./GameMonitorContent";
import { WorkMonitorContent } from "./WorkMonitorContent";
import { MusicActivityBadge } from "./MusicActivityBadge";
import { WorkActivityBadge } from "./WorkActivityBadge";
import { WorkstationArt } from "./WorkstationArt";
import {
  characterPositions,
  isSeatZone,
  resolveMemberSceneZones,
  sceneZones,
  seatSlots,
} from "../../features/voice-scene/sceneZones";
import { memberStatus } from "../../features/voice-scene/activityRules";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import type { ConnectionQualityLevel } from "../../features/network/networkDiagnostics";

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
  reduceMotion = false,
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
  reduceMotion?: boolean;
}) => {
  const islandRef = useRef<HTMLDivElement>(null);
  const visibleMembers = members.filter((member) => !member.isEmptySlot).slice(0, 5);
  const visibleAvatars = assignVisibleAvatars(visibleMembers);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);
  const [ambient, setAmbient] = useState<"day" | "evening" | "night">("day");
  const [hoveredZone, setHoveredZone] = useState<SceneZoneId>();
  const [welcomingMemberIds, setWelcomingMemberIds] = useState<Set<string>>(new Set());
  const [settledMemberZones, setSettledMemberZones] = useState<Record<string, SceneZoneId>>({});
  const previousMemberIdsRef = useRef<string[] | undefined>(undefined);
  const memberSignature = visibleMembers.map(sceneMemberKey).join("|");
  const visibleMemberIdSignature = visibleMembers.map((member) => member.id).join("|");
  const screenSharingSet = new Set(screenSharingPeerIds);
  const chatBubbleByPeerId = new Map(
    chatBubbles.map((message) => [message.peerId, message] as const),
  );
  const resolvedMemberZones = resolveMemberSceneZones(visibleMembers);
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
  const localMember = visibleMembers.find((member) => member.isLocal);
  const localZone = localMember ? resolvedMemberZones.get(localMember.id) : undefined;
  const awayMembers = visibleMembers.filter(
    (member) => resolvedMemberZones.get(member.id) === "restroomZone",
  );
  const handleMemberSettled = useCallback((memberId: string, zone: SceneZoneId) => {
    setSettledMemberZones((current) =>
      current[memberId] === zone ? current : { ...current, [memberId]: zone },
    );
  }, []);

  useEffect(() => {
    const activeMemberIds = new Set(visibleMemberIdSignature.split("|").filter(Boolean));
    setSettledMemberZones((current) => {
      const entries = Object.entries(current).filter(([memberId]) => activeMemberIds.has(memberId));
      return entries.length === Object.keys(current).length
        ? current
        : (Object.fromEntries(entries) as Record<string, SceneZoneId>);
    });
  }, [visibleMemberIdSignature]);

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

  useEffect(() => {
    const updateAmbient = () => {
      const hour = new Date().getHours();
      setAmbient(hour >= 22 || hour < 6 ? "night" : hour >= 18 ? "evening" : "day");
    };
    updateAmbient();
    const timer = window.setInterval(updateAmbient, 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
      className={`team-island ambient-${ambient} relative h-full min-h-[420px] overflow-hidden`}
      data-testid="team-island"
    >
      <span className="scene-knock-wave" data-knock-wave aria-hidden="true" />
      <div className="team-island-stage absolute inset-0" aria-hidden="true">
        <div className="scene-wall-backdrop" />
        <div className="scene-window-light" />
        <div className="scene-rug" />
        <div className="scene-brand-arc" />
        <div className="scene-window-nook">
          <SceneWindowNook />
        </div>
        <div className="scene-wall-shelf">
          <SceneWallShelf />
        </div>
        <div className="scene-wall-clock">
          <SceneWallClock />
        </div>
        <div className="scene-lounge-corner">
          <SceneTallPlant className="scene-lounge-plant" />
          <SceneLowTable className="scene-lounge-table" />
          <SceneFloorLamp className="scene-lounge-lamp" />
        </div>
        <div
          className={`scene-service-zone scene-service-restroom ${
            hoveredZone === "restroomZone" ? "is-hovered" : ""
          } ${localZone === "restroomZone" ? "is-current" : ""}`}
        >
          <SceneExitDoor className="scene-exit-door" />
          <span className="scene-exit-label">离开</span>
        </div>
        {seatSlots.map((slot) => {
          const occupant = memberBySeat.get(slot.id);
          const settledOccupant =
            occupant && settledMemberZones[occupant.id] === slot.id ? occupant : undefined;
          const occupantTone = occupant ? memberStatus(occupant).tone : undefined;
          const isScreenSharing = screenSharingSet.has(settledOccupant?.id ?? "");
          return (
            <div
              key={slot.id}
              className={`scene-workstation ${hoveredZone === slot.id ? "is-hovered" : ""} ${
                localZone === slot.id ? "is-current" : ""
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
                  } ${settledOccupant?.workActivity && !settledOccupant.gameName ? "working" : ""} ${
                    isScreenSharing ? "sharing" : ""
                  } ${networkQuality === "poor" && settledOccupant ? "network-unstable" : ""}`}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {settledOccupant ? (
                      <motion.span
                        key={`${settledOccupant.id}:${slot.id}:${
                          isScreenSharing
                            ? "sharing"
                            : (settledOccupant.gameName ??
                              settledOccupant.workActivity?.id ??
                              "idle")
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
                            shouldReduceMotion={shouldReduceMotion}
                          />
                        ) : settledOccupant.workActivity ? (
                          <WorkMonitorContent
                            activity={settledOccupant.workActivity}
                            shouldReduceMotion={shouldReduceMotion}
                          />
                        ) : (
                          <Fish className="scene-workstation-idle-fish" aria-label="摸鱼中" />
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
            if (
              !occupant ||
              (!occupant.musicActivity && !occupant.workActivity) ||
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
                  {occupant.musicActivity ? (
                    <MusicActivityBadge activity={occupant.musicActivity} />
                  ) : null}
                  {occupant.workActivity ? (
                    <WorkActivityBadge activity={occupant.workActivity} />
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
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
