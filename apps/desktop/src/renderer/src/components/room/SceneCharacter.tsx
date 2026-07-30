import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HeadphoneOff, Mic, MicOff, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion, useAnimationControls, usePresence } from "framer-motion";

import type {
  BuiltInAvatarId,
  RoomMember,
  SceneReaction as SceneReactionModel,
  SceneZoneId,
} from "@private-voice/shared";

import { memberVolumeToPercent, toggleLocalMemberMute } from "../../features/audio/memberVolume";
import { REMOTE_AUDIO_LEVEL_EVENT } from "../../features/audio/RemoteAudioMixer";
import { motionCurve } from "../../features/motion/motionSystem";
import { memberStatus } from "../../features/voice-scene/activityRules";
import { planCharacterRoute, sceneEntryPoint } from "../../features/voice-scene/characterMotion";
import {
  readSceneUnit,
  routeAnimation,
  scenePosition,
  type CharacterMotionPhase,
  waitForMotionPhase,
} from "../../features/voice-scene/characterMotionRuntime";
import {
  applyCharacterPersonality,
  getCharacterPersonality,
  weightedIdleActions,
} from "../../features/voice-scene/characterPersonality";
import { characterPositions, isSeatZone, sceneZones } from "../../features/voice-scene/sceneZones";
import { AnimalSprite } from "./AnimalSprite";
import {
  DeskAnimalSprite,
  type DeskAnimalIdleAction,
  WalkingAnimalSprite,
} from "./DeskAnimalSprite";
import { SceneCharacterLabel } from "./SceneCharacterLabel";
import { SceneReaction } from "./SceneReaction";

export const sceneMemberKey = (member: Pick<RoomMember, "id" | "isLocal">): string =>
  member.isLocal ? "local-member" : member.id;

const stableMotionPhase = (memberId: string): number => {
  let hash = 0;
  for (let index = 0; index < memberId.length; index += 1) {
    hash = (hash * 31 + memberId.charCodeAt(index)) >>> 0;
  }
  return -((hash % 2400) / 1000);
};

const stableMotionSeed = (memberId: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < memberId.length; index += 1) {
    hash ^= memberId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

export interface SceneCharacterProps {
  member: RoomMember;
  avatarId: BuiltInAvatarId;
  shouldReduceMotion: boolean;
  awayIndex: number;
  awayCount: number;
  zone: SceneZoneId;
  arrivalIndex: number;
  isWelcoming: boolean;
  isScreenSharing: boolean;
  reactions?: SceneReactionModel[];
  onReact?: (targetPeerId: string, emoji: SceneReactionModel["emoji"]) => void;
  onVolumeChange?: (memberId: string, volume: number) => void;
}

export const SceneCharacter = ({
  member,
  avatarId,
  shouldReduceMotion,
  awayIndex,
  awayCount,
  zone,
  arrivalIndex,
  isWelcoming,
  isScreenSharing,
  reactions = [],
  onReact,
  onVolumeChange,
}: SceneCharacterProps) => {
  const status = memberStatus(member);
  const personality = getCharacterPersonality(avatarId);
  const [isAudioControlsOpen, setIsAudioControlsOpen] = useState(false);
  const isSpeaking = status.tone === "speaking";
  const isReconnecting = status.tone === "reconnecting";
  const isOffline = status.tone === "offline";
  const isLocallyMuted = !member.isLocal && member.volume <= 0.001;
  const memberControlsRef = useRef<HTMLDivElement>(null);
  const previousAudibleVolumeRef = useRef(member.volume > 0 ? member.volume : 1);
  const basePosition = characterPositions[zone];
  const awayZone = sceneZones.find((candidate) => candidate.id === "restroomZone");
  const awayColumnCount = Math.min(3, Math.max(1, awayCount));
  const awayColumn = awayIndex % awayColumnCount;
  const awayRow = Math.floor(awayIndex / awayColumnCount);
  const position =
    zone === "restroomZone"
      ? {
          ...basePosition,
          left:
            (awayZone?.left ?? basePosition.left) + (awayColumn - (awayColumnCount - 1) / 2) * 5,
          top: (awayZone?.top ?? 80) - 7 + awayRow * 6,
          zIndex: basePosition.zIndex + awayIndex,
        }
      : basePosition;
  const controls = useAnimationControls();
  const [isPresent, safeToRemove] = usePresence();
  const [motionPhase, setMotionPhase] = useState<CharacterMotionPhase>(
    shouldReduceMotion ? (zone === "restroomZone" ? "away-idle" : "idle") : "entering",
  );
  const [movementDirection, setMovementDirection] = useState<"left" | "right">("right");
  const [strideDurationMs, setStrideDurationMs] = useState(520);
  const [displayZone, setDisplayZone] = useState<SceneZoneId>(zone);
  const [entryRevision, setEntryRevision] = useState(shouldReduceMotion ? 1 : 0);
  const didFinishEntryRef = useRef(shouldReduceMotion);
  const didStartEntryRef = useRef(shouldReduceMotion);
  const operationIdRef = useRef(0);

  useEffect(() => {
    if (member.volume > 0.001) previousAudibleVolumeRef.current = member.volume;
  }, [member.volume]);

  useEffect(() => {
    const expectedPeerId = member.isLocal ? "local-member" : member.id;
    const handleAudioLevel = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId?: string; level?: number }>).detail;
      if (detail?.peerId !== expectedPeerId || !memberControlsRef.current) return;
      const level = Math.max(0, Math.min(1, Number(detail.level) || 0));
      memberControlsRef.current.style.setProperty("--voice-level", level.toFixed(3));
      memberControlsRef.current.style.setProperty("--voice-scale", (1 + level * 0.038).toFixed(4));
      memberControlsRef.current.style.setProperty(
        "--voice-halo-opacity",
        (0.16 + level * 0.7).toFixed(3),
      );
      memberControlsRef.current.style.setProperty(
        "--voice-halo-scale",
        (0.82 + level * 0.3).toFixed(3),
      );
      memberControlsRef.current.style.setProperty(
        "--voice-glow-radius",
        `${Math.round(7 + level * 15)}px`,
      );
    };
    window.addEventListener(REMOTE_AUDIO_LEVEL_EVENT, handleAudioLevel);
    return () => {
      window.removeEventListener(REMOTE_AUDIO_LEVEL_EVENT, handleAudioLevel);
    };
  }, [member.id, member.isLocal]);

  useEffect(() => {
    if (!isAudioControlsOpen) return;

    const closeWhenClickingOutside = (event: PointerEvent) => {
      if (!memberControlsRef.current?.contains(event.target as Node)) {
        setIsAudioControlsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAudioControlsOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenClickingOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenClickingOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAudioControlsOpen]);
  const motionPhaseRef = useRef<CharacterMotionPhase>(motionPhase);
  const lastZoneRef = useRef<SceneZoneId>(zone);
  const activeTargetZoneRef = useRef<SceneZoneId>(zone);
  const currentPositionRef = useRef(
    shouldReduceMotion ? { left: position.left, top: position.top } : sceneEntryPoint(),
  );
  const isWalkingVisual = ["entering", "walking", "approaching", "turning", "leaving"].includes(
    motionPhase,
  );
  const isMoving = isWalkingVisual || motionPhase === "standing-up" || motionPhase === "sitting";
  const displayPosition = displayZone === zone ? position : characterPositions[displayZone];
  const renderedCharacterScale = isWalkingVisual ? 0.86 : displayPosition.scale;
  const isZoneTransitioning = displayZone !== zone;
  const targetLeft = position.left;
  const targetTop = position.top;

  useEffect(() => {
    motionPhaseRef.current = motionPhase;
  }, [motionPhase]);

  useLayoutEffect(() => {
    if (didFinishEntryRef.current) return;
    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const isFirstLeg = !didStartEntryRef.current;
    didStartEntryRef.current = true;

    if (shouldReduceMotion) {
      controls.set({
        ...scenePosition(targetLeft, targetTop),
        opacity: 1,
        scale: 1,
      });
      currentPositionRef.current = { left: targetLeft, top: targetTop };
      setDisplayZone(zone);
      setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
      didFinishEntryRef.current = true;
      setEntryRevision(1);
      return;
    }

    const enter = async () => {
      if (isFirstLeg && arrivalIndex > 0) {
        await waitForMotionPhase(Math.min(arrivalIndex, 4) * 110);
      }
      if (!isCurrentOperation()) return;
      setMotionPhase("entering");
      const routeKind = isFirstLeg ? "enter" : "move";
      const route = applyCharacterPersonality(
        planCharacterRoute({
          kind: routeKind,
          from: currentPositionRef.current,
          to: { left: targetLeft, top: targetTop },
          fromZone: isFirstLeg ? undefined : activeTargetZoneRef.current,
          toZone: zone,
        }),
        routeKind,
        personality,
      );
      activeTargetZoneRef.current = zone;
      setMovementDirection(route.direction);
      setStrideDurationMs(route.strideDurationMs);
      const animation = routeAnimation(route, !isFirstLeg);
      await controls.start({
        ...animation,
        opacity: 1,
        scale: 1,
        transition: {
          ...animation.transition,
          opacity: { duration: 0.32, ease: motionCurve.enter },
        },
      });
      if (!isCurrentOperation()) return;
      setMotionPhase("approaching");
      await waitForMotionPhase(120);
      if (!isCurrentOperation()) return;
      setMotionPhase("turning");
      await waitForMotionPhase(personality.turnPauseMs);
      if (!isCurrentOperation()) return;
      setDisplayZone(zone);
      setMotionPhase("sitting");
      await waitForMotionPhase(personality.landingSpring === "physical" ? 330 : 270);
      if (!isCurrentOperation()) return;
      didFinishEntryRef.current = true;
      lastZoneRef.current = zone;
      currentPositionRef.current = { left: targetLeft, top: targetTop };
      setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
      setEntryRevision((value) => value + 1);
    };

    void enter();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      controls.stop();
    };
  }, [arrivalIndex, controls, personality, shouldReduceMotion, targetLeft, targetTop, zone]);

  useEffect(() => {
    if (!isPresent || !didFinishEntryRef.current) return;
    const previousZone = lastZoneRef.current;
    const previousPosition = currentPositionRef.current;
    if (
      previousZone === zone &&
      previousPosition.left === targetLeft &&
      previousPosition.top === targetTop
    ) {
      return;
    }

    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const move = async () => {
      if (shouldReduceMotion) {
        controls.set({
          ...scenePosition(targetLeft, targetTop),
          opacity: 1,
          scale: 1,
        });
        currentPositionRef.current = { left: targetLeft, top: targetTop };
        lastZoneRef.current = zone;
        setDisplayZone(zone);
        setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
        return;
      }

      const wasAlreadyMoving = [
        "entering",
        "standing-up",
        "walking",
        "approaching",
        "turning",
        "leaving",
      ].includes(motionPhaseRef.current);
      if (!wasAlreadyMoving) {
        setMotionPhase("standing-up");
        await waitForMotionPhase(210);
        if (!isCurrentOperation()) return;
      }

      const route = applyCharacterPersonality(
        planCharacterRoute({
          kind: "move",
          from: currentPositionRef.current,
          to: { left: targetLeft, top: targetTop },
          fromZone: wasAlreadyMoving ? activeTargetZoneRef.current : previousZone,
          toZone: zone,
        }),
        "move",
        personality,
      );
      activeTargetZoneRef.current = zone;
      setMovementDirection(route.direction);
      setStrideDurationMs(route.strideDurationMs);
      setMotionPhase("walking");
      await controls.start({
        ...routeAnimation(route, wasAlreadyMoving),
        scale: 1,
      });
      if (!isCurrentOperation()) return;
      setMotionPhase("approaching");
      await waitForMotionPhase(120);
      if (!isCurrentOperation()) return;
      setMotionPhase("turning");
      await waitForMotionPhase(personality.turnPauseMs);
      if (!isCurrentOperation()) return;
      lastZoneRef.current = zone;
      currentPositionRef.current = { left: targetLeft, top: targetTop };
      setDisplayZone(zone);
      setMotionPhase("sitting");
      await waitForMotionPhase(personality.landingSpring === "physical" ? 320 : 250);
      if (isCurrentOperation()) {
        setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
      }
    };
    void move();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      controls.stop();
    };
  }, [
    controls,
    entryRevision,
    isPresent,
    personality,
    shouldReduceMotion,
    targetLeft,
    targetTop,
    zone,
  ]);

  useEffect(() => {
    if (isPresent) return;
    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const leave = async () => {
      setMotionPhase("standing-up");
      if (!shouldReduceMotion) await waitForMotionPhase(220);
      if (!isCurrentOperation()) return;
      setMovementDirection("left");
      setMotionPhase("leaving");
      if (!shouldReduceMotion) {
        const route = applyCharacterPersonality(
          planCharacterRoute({
            kind: "exit",
            from: currentPositionRef.current,
            to: sceneEntryPoint(),
            fromZone: activeTargetZoneRef.current,
          }),
          "exit",
          personality,
        );
        setStrideDurationMs(route.strideDurationMs);
        const animation = routeAnimation(route);
        await controls.start({
          ...animation,
          opacity: 0,
          scale: 1,
          transition: {
            ...animation.transition,
            opacity: { duration: 0.3, delay: Math.max(0, route.duration - 0.3) },
          },
        });
      }
      if (isCurrentOperation()) safeToRemove?.();
    };
    void leave();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      controls.stop();
    };
  }, [controls, isPresent, personality, safeToRemove, shouldReduceMotion]);

  const [idleAction, setIdleAction] = useState<DeskAnimalIdleAction>("none");

  useEffect(() => {
    if (
      shouldReduceMotion ||
      isMoving ||
      isSpeaking ||
      member.activity === "gaming" ||
      zone === "restroomZone"
    ) {
      setIdleAction("none");
      return;
    }

    const seed = stableMotionSeed(member.id);
    const idleActions = weightedIdleActions(personality);
    let actionIndex = seed % idleActions.length;
    let actionTimer: number | undefined;
    let resetTimer: number | undefined;
    const schedule = (delay: number) => {
      actionTimer = window.setTimeout(() => {
        const nextAction = idleActions[actionIndex % idleActions.length] ?? "look";
        actionIndex += 1;
        setIdleAction(nextAction);
        resetTimer = window.setTimeout(
          () => {
            setIdleAction("none");
            schedule(8_800 + ((seed + actionIndex * 997) % 4_800));
          },
          nextAction === "stretch" ? 2_100 : 1_700,
        );
      }, delay);
    };

    schedule(4_800 + (seed % 4_600));
    return () => {
      if (actionTimer !== undefined) window.clearTimeout(actionTimer);
      if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    };
  }, [isMoving, isSpeaking, member.activity, member.id, personality, shouldReduceMotion, zone]);

  return (
    <motion.div
      initial={
        shouldReduceMotion
          ? {
              ...scenePosition(position.left, position.top),
              opacity: 1,
              scale: 1,
            }
          : {
              ...scenePosition(sceneEntryPoint().left, sceneEntryPoint().top),
              opacity: 0,
              scale: 1,
            }
      }
      animate={controls}
      className={`scene-character-motion phase-${motionPhase} pointer-events-none absolute`}
      data-arrival-action={personality.arrivalAction}
      data-greeting-style={personality.greetingStyle}
      data-scene-member-key={sceneMemberKey(member)}
      data-motion-phase={motionPhase}
      data-zone-transitioning={isZoneTransitioning ? "true" : "false"}
      onUpdate={(latest) => {
        const current = currentPositionRef.current;
        currentPositionRef.current = {
          left: readSceneUnit(latest.x, current.left),
          top: readSceneUnit(latest.y, current.top),
        };
      }}
      style={{
        opacity: isOffline ? 0.45 : undefined,
        zIndex: position.zIndex,
      }}
    >
      <div className="-translate-x-1/2" data-gsap-character>
        <div
          ref={memberControlsRef}
          className={`scene-character-anchor relative ${
            isAudioControlsOpen ? "is-audio-controls-open" : ""
          }`}
          style={
            {
              "--character-scale": renderedCharacterScale,
              "--label-offset-y": `${position.labelOffsetY ?? 0}px`,
              "--character-motion-delay": `${stableMotionPhase(member.id)}s`,
              "--voice-level": 0,
              "--voice-scale": 1,
              "--voice-halo-opacity": 0.16,
              "--voice-halo-scale": 0.82,
              "--voice-glow-radius": "7px",
            } as CSSProperties & Record<string, string | number>
          }
        >
          <div
            className={`room-character-interaction-target ${
              member.isLocal ? "" : "is-interactive pointer-events-auto"
            }`}
            role={member.isLocal ? undefined : "button"}
            tabIndex={member.isLocal ? undefined : 0}
            aria-label={member.isLocal ? undefined : `调整${member.nickname}的本地音量`}
            aria-expanded={member.isLocal ? undefined : isAudioControlsOpen}
            onClick={
              member.isLocal ? undefined : () => setIsAudioControlsOpen((current) => !current)
            }
            onKeyDown={
              member.isLocal
                ? undefined
                : (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setIsAudioControlsOpen((current) => !current);
                  }
            }
          >
            <div
              className={`room-character-sprite relative ${
                isSpeaking ? "room-character-speaking" : ""
              } ${member.isMuted ? "room-character-muted" : ""} ${
                member.isDeafened ? "room-character-deafened" : ""
              } ${isReconnecting ? "room-character-reconnecting" : ""}`}
            >
              {isWalkingVisual ? (
                <WalkingAnimalSprite
                  avatarId={avatarId}
                  direction={movementDirection}
                  strideDurationMs={strideDurationMs}
                  paused={motionPhase === "turning"}
                />
              ) : isSeatZone(displayZone) ? (
                <DeskAnimalSprite
                  avatarId={avatarId}
                  activity={member.activity ?? "idle"}
                  isSpeaking={isSpeaking}
                  isMoving={isMoving}
                  isMuted={member.isMuted}
                  isScreenSharing={isScreenSharing}
                  isWelcoming={isWelcoming}
                  idleAction={idleAction}
                />
              ) : (
                <AnimalSprite avatarId={avatarId} state="away" isMoving={isMoving} />
              )}
              {member.isDeafened ? (
                <span className="room-character-deafened-badge" aria-label="已关闭扬声器">
                  <HeadphoneOff className="h-3 w-3" />
                </span>
              ) : null}
              {isLocallyMuted ? (
                <span className="room-character-local-muted-badge" aria-label="已在本机静音">
                  <VolumeX className="h-3 w-3" />
                </span>
              ) : null}
            </div>
          </div>

          <SceneCharacterLabel
            member={member}
            isAway={displayZone === "restroomZone"}
            shouldReduceMotion={shouldReduceMotion}
          />
          <SceneReaction reactions={reactions} shouldReduceMotion={shouldReduceMotion} />

          <AnimatePresence>
            {!member.isLocal && isAudioControlsOpen ? (
              <motion.div
                className="member-audio-popover pointer-events-auto"
                role="dialog"
                aria-label={`${member.nickname}的本地声音设置`}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 7, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={shouldReduceMotion ? undefined : { opacity: 0, y: 5, scale: 0.97 }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 0.2,
                  ease: motionCurve.enter,
                }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="member-audio-popover-header">
                  <span className="min-w-0">
                    <strong title={member.nickname}>{member.nickname}</strong>
                    <small>
                      {member.isMuted
                        ? "对方已闭麦"
                        : member.isDeafened
                          ? "对方已关闭扬声器"
                          : member.gameName || "麦克风正常"}
                    </small>
                  </span>
                  <span>
                    {typeof member.latencyMs === "number" ? (
                      <small className="member-audio-latency">
                        {Math.round(member.latencyMs)} ms
                      </small>
                    ) : null}
                    <span className={`member-audio-percent ${isLocallyMuted ? "is-muted" : ""}`}>
                      {memberVolumeToPercent(member.volume)}%
                    </span>
                  </span>
                </div>

                <label className="member-audio-slider">
                  <span className="sr-only">他的声音</span>
                  {member.isMuted ? (
                    <MicOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Mic className="h-4 w-4" aria-hidden="true" />
                  )}
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={memberVolumeToPercent(member.volume)}
                    aria-label={`${member.nickname}本地播放音量`}
                    onChange={(event) =>
                      onVolumeChange?.(member.id, Number(event.target.value) / 100)
                    }
                  />
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                </label>

                <div className="member-audio-actions">
                  <button
                    type="button"
                    className={isLocallyMuted ? "is-muted" : ""}
                    onClick={() =>
                      onVolumeChange?.(
                        member.id,
                        toggleLocalMemberMute(member.volume, previousAudibleVolumeRef.current),
                      )
                    }
                  >
                    <VolumeX className="h-3.5 w-3.5" />
                    {isLocallyMuted ? "取消静音" : "仅我静音"}
                  </button>
                  <button
                    type="button"
                    disabled={Math.abs(member.volume - 1) < 0.001}
                    onClick={() => onVolumeChange?.(member.id, 1)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    恢复 100%
                  </button>
                </div>
                <div
                  className="member-reaction-actions"
                  aria-label={`给${member.nickname}发送表情`}
                >
                  {(["👍", "🔥", "😂", "❤️", "👏", "😭", "😮", "💀", "🎉", "👀"] as const).map(
                    (emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => onReact?.(member.id, emoji)}
                        aria-label={`发送${emoji}`}
                      >
                        {emoji}
                      </button>
                    ),
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};
