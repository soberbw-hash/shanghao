import {
  memo,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { HeadphoneOff, RefreshCw, VolumeX } from "lucide-react";
import { AnimatePresence, motion, usePresence } from "framer-motion";

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
  characterMotionTiming,
  characterRouteKeyframes,
  readRenderedScenePosition,
  sceneTransform,
  type CharacterMotionPhase,
  waitForMotionPhase,
} from "../../features/voice-scene/characterMotionRuntime";
import {
  applyCharacterPersonality,
  getCharacterPersonality,
  type CharacterIdleAction,
} from "../../features/voice-scene/characterPersonality";
import { characterPositions, isSeatZone, sceneZones } from "../../features/voice-scene/sceneZones";
import { AnimalSprite } from "./AnimalSprite";
import { DeskAnimalSprite, WalkingAnimalSprite } from "./DeskAnimalSprite";
import { SceneCharacterLabel } from "./SceneCharacterLabel";
import { SceneReaction } from "./SceneReaction";
import { Slider } from "../base/Slider";
import { sceneMemberKey } from "./sceneMemberKey";

export interface SceneCharacterQuickMessage {
  id: string;
  content: string;
  createdAt: string;
}

const CHAT_BUBBLE_VISIBLE_MS = 4_200;

const CharacterChatBubble = ({
  message,
  shouldReduceMotion,
}: {
  message?: SceneCharacterQuickMessage;
  shouldReduceMotion: boolean;
}) => {
  const [visibleMessage, setVisibleMessage] = useState<SceneCharacterQuickMessage>();

  useEffect(() => {
    if (!message) {
      setVisibleMessage(undefined);
      return;
    }

    const createdAt = Date.parse(message.createdAt);
    const elapsed = Number.isFinite(createdAt) ? Math.max(0, Date.now() - createdAt) : 0;
    const remaining = CHAT_BUBBLE_VISIBLE_MS - elapsed;
    if (remaining <= 0) {
      setVisibleMessage(undefined);
      return;
    }

    setVisibleMessage(message);
    const timeout = window.setTimeout(() => {
      setVisibleMessage((current) => (current?.id === message.id ? undefined : current));
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [message]);

  return (
    <div className="scene-character-chat-bubble-position" aria-live="polite">
      <AnimatePresence initial={false} mode="wait">
        {visibleMessage ? (
          <motion.div
            key={visibleMessage.id}
            className="scene-character-chat-bubble"
            role="status"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -3, scale: 0.98 }}
            transition={{
              duration: shouldReduceMotion ? 0 : characterMotionTiming.chatBubbleSeconds,
              ease: motionCurve.enter,
            }}
          >
            {visibleMessage.content}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

const stableMotionPhase = (memberId: string): number => {
  let hash = 0;
  for (let index = 0; index < memberId.length; index += 1) {
    hash = (hash * 31 + memberId.charCodeAt(index)) >>> 0;
  }
  return -((hash % 2400) / 1000);
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
  idleAction?: CharacterIdleAction;
  reactions?: SceneReactionModel[];
  chatBubble?: SceneCharacterQuickMessage;
  onReact?: (targetPeerId: string, emoji: SceneReactionModel["emoji"]) => void;
  onVolumeChange?: (memberId: string, volume: number) => void;
  onSettled?: (memberId: string, zone: SceneZoneId) => void;
  onExited?: (memberId: string) => void;
}

const SceneCharacterView = ({
  member,
  avatarId,
  shouldReduceMotion,
  awayIndex,
  awayCount,
  zone,
  isWelcoming,
  isScreenSharing,
  idleAction = "none",
  reactions = [],
  chatBubble,
  onVolumeChange,
  onSettled,
  onExited,
}: SceneCharacterProps) => {
  const status = memberStatus(member);
  const personality = getCharacterPersonality(avatarId);
  const [isAudioControlsOpen, setIsAudioControlsOpen] = useState(false);
  const isSpeaking = status.tone === "speaking";
  const isReconnecting = status.tone === "reconnecting";
  const isUpdating = status.label === "正在更新";
  const isOffline = status.tone === "offline";
  const isLocallyMuted = !member.isLocal && member.volume <= 0.001;
  const memberControlsRef = useRef<HTMLDivElement>(null);
  const previousAudibleVolumeRef = useRef(member.volume > 0 ? member.volume : 1);
  const lastVisualAudioLevelRef = useRef(-1);
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
  const [isPresent, safeToRemove] = usePresence();
  const [motionPhase, setMotionPhase] = useState<CharacterMotionPhase>(
    shouldReduceMotion ? (zone === "restroomZone" ? "away-idle" : "idle") : "entering",
  );
  const [movementDirection, setMovementDirection] = useState<"left" | "right">("right");
  const [displayZone, setDisplayZone] = useState<SceneZoneId>(zone);
  const didStartEntryRef = useRef(shouldReduceMotion);
  const operationIdRef = useRef(0);
  const onSettledRef = useRef(onSettled);
  const onExitedRef = useRef(onExited);
  const motionElementRef = useRef<HTMLDivElement>(null);
  const activeRouteAnimationRef = useRef<Animation | undefined>(undefined);
  const activeOpacityAnimationRef = useRef<Animation | undefined>(undefined);

  useEffect(() => {
    if (member.volume > 0.001) previousAudibleVolumeRef.current = member.volume;
  }, [member.volume]);

  useEffect(() => {
    const expectedPeerId = member.isLocal ? "local-member" : member.id;
    const handleAudioLevel = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId?: string; level?: number }>).detail;
      if (detail?.peerId !== expectedPeerId || !memberControlsRef.current) return;
      const level = Math.round(Math.max(0, Math.min(1, Number(detail.level) || 0)) * 100) / 100;
      if (level === lastVisualAudioLevelRef.current) return;
      lastVisualAudioLevelRef.current = level;
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
      if (event.key === "Escape") {
        setIsAudioControlsOpen(false);
      }
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
  const renderedCharacterScale = displayPosition.scale;
  const displayedActivity =
    displayZone === zone ? member.activity : displayZone === "restroomZone" ? "restroom" : "idle";
  const displayedMember =
    displayedActivity === member.activity ? member : { ...member, activity: displayedActivity };
  const targetLeft = position.left;
  const targetTop = position.top;
  const targetOpacity = isOffline ? 0.45 : 1;
  const targetOpacityRef = useRef(targetOpacity);
  const previousTargetOpacityRef = useRef(targetOpacity);

  const stopActiveAnimations = useCallback(() => {
    const element = motionElementRef.current;
    if (!element) return;
    const current = currentPositionRef.current;
    const renderedPosition = readRenderedScenePosition(element, current);
    const renderedOpacity = window.getComputedStyle(element).opacity;
    activeRouteAnimationRef.current?.cancel();
    activeOpacityAnimationRef.current?.cancel();
    activeRouteAnimationRef.current = undefined;
    activeOpacityAnimationRef.current = undefined;
    current.left = renderedPosition.left;
    current.top = renderedPosition.top;
    element.style.transform = sceneTransform(renderedPosition.left, renderedPosition.top);
    element.style.opacity = renderedOpacity;
  }, []);

  useEffect(() => {
    motionPhaseRef.current = motionPhase;
  }, [motionPhase]);

  useLayoutEffect(() => {
    targetOpacityRef.current = targetOpacity;
  }, [targetOpacity]);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useLayoutEffect(() => {
    if (!isPresent) return;
    const element = motionElementRef.current;
    if (!element) return;
    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const isFirstRoute = !didStartEntryRef.current;
    didStartEntryRef.current = true;

    if (shouldReduceMotion) {
      element.style.transform = sceneTransform(targetLeft, targetTop);
      element.style.opacity = String(targetOpacityRef.current);
      currentPositionRef.current = { left: targetLeft, top: targetTop };
      lastZoneRef.current = zone;
      activeTargetZoneRef.current = zone;
      setDisplayZone(zone);
      setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
      onSettledRef.current?.(member.id, zone);
      return;
    }

    const travel = async () => {
      const previousZone = lastZoneRef.current;
      const previousPosition = currentPositionRef.current;
      const isAlreadyAtTarget =
        !isFirstRoute &&
        previousZone === zone &&
        Math.abs(previousPosition.left - targetLeft) < 0.02 &&
        Math.abs(previousPosition.top - targetTop) < 0.02;
      if (isAlreadyAtTarget) {
        element.style.transform = sceneTransform(targetLeft, targetTop);
        element.style.opacity = String(targetOpacityRef.current);
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

      // Going to the away area should hand directly from the seated pose to the
      // walking pose. The old 72 ms stand-up phase cut a longer CSS animation
      // mid-frame and caused the small visible twitch when clicking “离开”.
      if (!isFirstRoute && !wasAlreadyMoving && zone !== "restroomZone") {
        setMotionPhase("standing-up");
        await waitForMotionPhase(72);
        if (!isCurrentOperation()) return;
      }

      const routeKind = isFirstRoute ? "enter" : "move";
      const route = applyCharacterPersonality(
        planCharacterRoute({
          kind: routeKind,
          from: currentPositionRef.current,
          to: { left: targetLeft, top: targetTop },
          fromZone: isFirstRoute
            ? undefined
            : wasAlreadyMoving
              ? activeTargetZoneRef.current
              : previousZone,
          toZone: zone,
        }),
        routeKind,
        personality,
      );
      activeTargetZoneRef.current = zone;
      setMovementDirection(route.direction);
      // Restore normal size during the first couple of return steps instead of
      // keeping the away-area scale for the entire walk and popping at the desk.
      if (previousZone === "restroomZone" && isSeatZone(zone)) setDisplayZone(zone);
      setMotionPhase(isFirstRoute ? "entering" : "walking");
      const routeMotion = element.animate(
        characterRouteKeyframes(route, !isFirstRoute || wasAlreadyMoving),
        {
          duration: route.duration * 1_000,
          fill: "forwards",
        },
      );
      const opacityMotion = element.animate(
        [
          { opacity: window.getComputedStyle(element).opacity },
          { opacity: targetOpacityRef.current },
        ],
        {
          duration: characterMotionTiming.routeOpacitySeconds * 1_000,
          easing: `cubic-bezier(${motionCurve.enter.join(", ")})`,
          fill: "forwards",
        },
      );
      activeRouteAnimationRef.current = routeMotion;
      activeOpacityAnimationRef.current = opacityMotion;
      await Promise.race([
        routeMotion.finished.catch(() => undefined),
        waitForMotionPhase(Math.ceil(route.duration * 1_000) + 480),
      ]);
      if (!isCurrentOperation()) return;
      // Renderer throttling or an interrupted texture decode must not leave a
      // late joiner suspended on its entry frame. Finish at the assigned seat.
      element.style.transform = sceneTransform(targetLeft, targetTop);
      element.style.opacity = String(targetOpacityRef.current);
      routeMotion.cancel();
      opacityMotion.cancel();
      if (activeRouteAnimationRef.current === routeMotion) {
        activeRouteAnimationRef.current = undefined;
      }
      if (activeOpacityAnimationRef.current === opacityMotion) {
        activeOpacityAnimationRef.current = undefined;
      }
      lastZoneRef.current = zone;
      currentPositionRef.current = { left: targetLeft, top: targetTop };
      setDisplayZone(zone);
      setMotionPhase("sitting");
      await waitForMotionPhase(
        personality.landingSpring === "physical"
          ? characterMotionTiming.landingPhysicalMs
          : characterMotionTiming.landingSoftMs,
      );
      if (!isCurrentOperation()) return;
      setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
      onSettledRef.current?.(member.id, zone);
    };

    void travel();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      stopActiveAnimations();
    };
  }, [
    isPresent,
    member.id,
    personality,
    shouldReduceMotion,
    stopActiveAnimations,
    targetLeft,
    targetTop,
    zone,
  ]);

  useLayoutEffect(() => {
    const element = motionElementRef.current;
    if (!element) return;
    if (previousTargetOpacityRef.current === targetOpacity) return;
    previousTargetOpacityRef.current = targetOpacity;
    const nextOpacity = targetOpacity;
    if (shouldReduceMotion) {
      element.style.opacity = String(nextOpacity);
      return;
    }

    const opacityMotion = element.animate(
      [{ opacity: window.getComputedStyle(element).opacity }, { opacity: nextOpacity }],
      {
        duration: characterMotionTiming.routeOpacitySeconds * 1_000,
        easing: `cubic-bezier(${motionCurve.enter.join(", ")})`,
        fill: "forwards",
      },
    );
    activeOpacityAnimationRef.current = opacityMotion;
    return () => {
      opacityMotion.cancel();
      if (activeOpacityAnimationRef.current === opacityMotion) {
        activeOpacityAnimationRef.current = undefined;
      }
    };
  }, [shouldReduceMotion, targetOpacity]);

  useEffect(() => {
    if (isPresent) return;
    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const leave = async () => {
      const element = motionElementRef.current;
      if (!element) {
        safeToRemove?.();
        onExitedRef.current?.(member.id);
        return;
      }
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
        // Exit directly from the character's current rendered position. Keeping
        // velocity through intermediate waypoints avoids the visible stop that
        // used to happen between the stand-up phase and the route animation.
        const routeMotion = element.animate(characterRouteKeyframes(route, true), {
          duration: route.duration * 1_000,
          fill: "forwards",
        });
        const opacityMotion = element.animate(
          [{ opacity: window.getComputedStyle(element).opacity }, { opacity: 0 }],
          {
            delay: Math.max(0, route.duration - characterMotionTiming.exitOpacitySeconds) * 1_000,
            duration: characterMotionTiming.exitOpacitySeconds * 1_000,
            easing: `cubic-bezier(${motionCurve.enter.join(", ")})`,
            fill: "forwards",
          },
        );
        activeRouteAnimationRef.current = routeMotion;
        activeOpacityAnimationRef.current = opacityMotion;
        await Promise.race([
          routeMotion.finished.catch(() => undefined),
          waitForMotionPhase(Math.ceil(route.duration * 1_000) + 480),
        ]);
        if (!isCurrentOperation()) return;
        const exitPoint = sceneEntryPoint();
        element.style.transform = sceneTransform(exitPoint.left, exitPoint.top);
        element.style.opacity = "0";
        routeMotion.cancel();
        opacityMotion.cancel();
        if (activeRouteAnimationRef.current === routeMotion) {
          activeRouteAnimationRef.current = undefined;
        }
        if (activeOpacityAnimationRef.current === opacityMotion) {
          activeOpacityAnimationRef.current = undefined;
        }
      }
      if (isCurrentOperation()) {
        safeToRemove?.();
        onExitedRef.current?.(member.id);
      }
    };
    void leave();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      stopActiveAnimations();
    };
  }, [isPresent, member.id, personality, safeToRemove, shouldReduceMotion, stopActiveAnimations]);

  return (
    <div
      ref={motionElementRef}
      className={`scene-character-motion phase-${motionPhase} pointer-events-none absolute`}
      data-arrival-action={personality.arrivalAction}
      data-greeting-style={personality.greetingStyle}
      data-scene-member-key={sceneMemberKey(member)}
      data-motion-phase={motionPhase}
      data-movement-direction={movementDirection}
      style={{
        transform: shouldReduceMotion
          ? sceneTransform(position.left, position.top)
          : sceneTransform(sceneEntryPoint().left, sceneEntryPoint().top),
        opacity: shouldReduceMotion ? targetOpacity : 0,
        zIndex: isAudioControlsOpen ? 80 : position.zIndex,
      }}
    >
      <div className="-translate-x-1/2" data-gsap-character>
        <div
          ref={memberControlsRef}
          className={`scene-character-anchor relative ${
            isAudioControlsOpen ? "is-audio-controls-open" : ""
          }`}
          data-scene-zone={displayZone}
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
            title={member.isLocal ? undefined : `点击调整${member.nickname}在本机的音量`}
            aria-expanded={member.isLocal ? undefined : isAudioControlsOpen}
            onClick={
              member.isLocal
                ? undefined
                : () => {
                    setIsAudioControlsOpen((current) => !current);
                  }
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
              data-updating={isUpdating || undefined}
            >
              {/* Keep every pose mounted so the decoded character texture survives a seat
                  change. Only the active layer changes opacity; there is never a frame with
                  no character while seated, walking and away poses hand off. */}
              <span
                className={`room-character-visual-layer room-character-walking-layer ${
                  isWalkingVisual ? "is-active" : ""
                }`}
                aria-hidden={!isWalkingVisual}
              >
                <WalkingAnimalSprite
                  avatarId={avatarId}
                  direction={movementDirection}
                  paused={motionPhase === "turning"}
                />
              </span>
              <span
                className={`room-character-visual-layer room-character-seated-layer ${
                  !isWalkingVisual && isSeatZone(displayZone) ? "is-active" : ""
                }`}
                aria-hidden={isWalkingVisual || !isSeatZone(displayZone)}
              >
                <DeskAnimalSprite
                  avatarId={avatarId}
                  activity={displayedActivity ?? "idle"}
                  isSpeaking={isSpeaking}
                  isMoving={isMoving}
                  isMuted={member.isMuted}
                  isScreenSharing={isScreenSharing}
                  isWelcoming={isWelcoming}
                  idleAction={idleAction}
                />
              </span>
              <span
                className={`room-character-visual-layer room-character-away-layer ${
                  !isWalkingVisual && !isSeatZone(displayZone) ? "is-active" : ""
                }`}
                aria-hidden={isWalkingVisual || isSeatZone(displayZone)}
              >
                <AnimalSprite avatarId={avatarId} state="away" isMoving={isMoving} />
              </span>
              {isReconnecting && !isUpdating ? (
                <span className="room-character-reconnect-steps" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
              {isUpdating ? (
                <span className="room-character-update-device" aria-label="正在更新客户端">
                  <span>
                    <RefreshCw aria-hidden="true" />
                  </span>
                </span>
              ) : null}
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
            <SceneCharacterLabel member={displayedMember} isAway={displayZone === "restroomZone"} />
          </div>
          <CharacterChatBubble message={chatBubble} shouldReduceMotion={shouldReduceMotion} />
          <SceneReaction reactions={reactions} shouldReduceMotion={shouldReduceMotion} />

          <AnimatePresence>
            {!member.isLocal && isAudioControlsOpen ? (
              <motion.div
                className="member-audio-popover is-label-control pointer-events-auto"
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
                <button
                  type="button"
                  className={`member-audio-mute-toggle ${isLocallyMuted ? "is-muted" : ""}`}
                  aria-label={
                    isLocallyMuted ? `取消静音${member.nickname}` : `仅在本机静音${member.nickname}`
                  }
                  title={isLocallyMuted ? "取消静音" : "仅在本机静音"}
                  onClick={() =>
                    onVolumeChange?.(
                      member.id,
                      toggleLocalMemberMute(member.volume, previousAudibleVolumeRef.current),
                    )
                  }
                >
                  <VolumeX aria-hidden="true" />
                </button>
                <label className="member-audio-slider" title={`${member.nickname}的本地音量`}>
                  <span className="sr-only">他的声音</span>
                  <Slider
                    min={0}
                    max={300}
                    step={5}
                    value={memberVolumeToPercent(member.volume)}
                    referenceValue={100}
                    snapThreshold={10}
                    aria-label={`${member.nickname}本地播放音量`}
                    onChange={(event) =>
                      onVolumeChange?.(member.id, Number(event.target.value) / 100)
                    }
                  />
                </label>
                <output
                  className={`member-audio-percent ${isLocallyMuted ? "is-muted" : ""}`}
                  aria-live="polite"
                >
                  {memberVolumeToPercent(member.volume)}%
                </output>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const areReactionListsEqual = (
  left: SceneReactionModel[] | undefined,
  right: SceneReactionModel[] | undefined,
): boolean => {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((reaction, index) => reaction.id === right[index]?.id);
};

export const SceneCharacter = memo(
  SceneCharacterView,
  (previous, next) =>
    previous.member === next.member &&
    previous.avatarId === next.avatarId &&
    previous.shouldReduceMotion === next.shouldReduceMotion &&
    previous.awayIndex === next.awayIndex &&
    previous.awayCount === next.awayCount &&
    previous.zone === next.zone &&
    previous.arrivalIndex === next.arrivalIndex &&
    previous.isWelcoming === next.isWelcoming &&
    previous.isScreenSharing === next.isScreenSharing &&
    previous.idleAction === next.idleAction &&
    areReactionListsEqual(previous.reactions, next.reactions) &&
    previous.chatBubble === next.chatBubble &&
    previous.onReact === next.onReact &&
    previous.onVolumeChange === next.onVolumeChange &&
    previous.onSettled === next.onSettled &&
    previous.onExited === next.onExited,
);
