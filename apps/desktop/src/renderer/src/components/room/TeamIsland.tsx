import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Fish, Gamepad2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
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
import { SceneFloorLamp, SceneWindowNook } from "./SceneAmbientDecor";
import { SceneCharacter, sceneMemberKey } from "./SceneCharacter";
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
  const previousMemberIdsRef = useRef<string[]>();
  const memberSignature = visibleMembers.map(sceneMemberKey).join("|");
  const screenSharingSet = new Set(screenSharingPeerIds);
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
        <div className="scene-window-light" />
        <div className="scene-rug" />
        <div className="scene-brand-arc" />
        <div className="scene-window-nook">
          <SceneWindowNook />
        </div>
        <div className="scene-floor-lamp">
          <SceneFloorLamp />
        </div>
        <div className="scene-service-zone scene-service-restroom">
          <span>离开一下</span>
        </div>
        {seatSlots.map((slot) => {
          const occupant = memberBySeat.get(slot.id);
          const occupantTone = occupant ? memberStatus(occupant).tone : undefined;
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
                  className={`scene-workstation-screen ${occupant ? "online" : ""} ${
                    occupant?.gameName ? "gaming" : ""
                  } ${screenSharingSet.has(occupant?.id ?? "") ? "sharing" : ""} ${
                    networkQuality === "poor" && occupant ? "network-unstable" : ""
                  }`}
                >
                  {screenSharingSet.has(occupant?.id ?? "") ? (
                    <span className="scene-workstation-sharing-mark">共享中</span>
                  ) : occupant?.gameName ? (
                    <>
                      <Gamepad2 aria-hidden="true" />
                      <span>{occupant.gameName}</span>
                    </>
                  ) : occupant ? (
                    <Fish className="scene-workstation-idle-fish" aria-label="摸鱼中" />
                  ) : null}
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

      <div className="absolute inset-0 z-50">
        {sceneZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`scene-zone-hotspot ${zone.kind === "seat" ? "seat" : "activity"} ${
              localZone === zone.id ? "current" : ""
            }`}
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
              reaction={[...reactions]
                .reverse()
                .find(
                  (reaction) =>
                    reaction.targetPeerId === member.id &&
                    Date.now() - Date.parse(reaction.createdAt) < 4_000,
                )}
              onReact={onReact}
              onVolumeChange={onVolumeChange}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
