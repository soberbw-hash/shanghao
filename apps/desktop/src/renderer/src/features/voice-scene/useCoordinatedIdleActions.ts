import { useEffect, useMemo, useRef, useState } from "react";

import type { BuiltInAvatarId } from "@private-voice/shared";

import {
  getCharacterPersonality,
  weightedIdleActions,
  type CharacterIdleAction,
} from "./characterPersonality";

export interface CharacterIdleCandidate {
  id: string;
  avatarId: BuiltInAvatarId;
  eligible: boolean;
}

const stableSeed = (value: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const actionDuration = (action: CharacterIdleAction): number => {
  if (action === "blink" || action === "ear") return 900;
  if (action === "stretch" || action === "yawn") return 2_200;
  return 1_750;
};

/** One low-frequency scheduler owns decorative idles for the whole room. */
export const useCoordinatedIdleActions = (
  candidates: CharacterIdleCandidate[],
  paused: boolean,
): Record<string, CharacterIdleAction> => {
  const [actions, setActions] = useState<Record<string, CharacterIdleAction>>({});
  const signature = useMemo(
    () => candidates.map(({ id, avatarId, eligible }) => `${id}:${avatarId}:${eligible}`).join("|"),
    [candidates],
  );
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  useEffect(() => {
    setActions({});
    const scheduledCandidates = candidatesRef.current;
    if (paused || scheduledCandidates.length === 0) return;

    const active = new Set<string>();
    const actionIndexes = new Map(scheduledCandidates.map(({ id }) => [id, stableSeed(id)]));
    const resetTimers = new Set<number>();
    let round = 0;
    let scheduleTimer: number | undefined;

    const schedule = (delay: number) => {
      scheduleTimer = window.setTimeout(() => {
        if (document.visibilityState === "hidden") {
          schedule(4_000);
          return;
        }
        const available = scheduledCandidates
          .filter((candidate) => candidate.eligible && !active.has(candidate.id))
          .sort(
            (left, right) =>
              (stableSeed(`${left.id}:${round}`) % 10_000) -
              (stableSeed(`${right.id}:${round}`) % 10_000),
          );
        const capacity = Math.max(0, 2 - active.size);
        const startCount = Math.min(capacity, available.length, round % 3 === 2 ? 2 : 1);
        available.slice(0, startCount).forEach((candidate) => {
          const weighted = weightedIdleActions(getCharacterPersonality(candidate.avatarId));
          const index = actionIndexes.get(candidate.id) ?? 0;
          const action = weighted[index % weighted.length] ?? "blink";
          actionIndexes.set(candidate.id, index + 1);
          active.add(candidate.id);
          setActions((current) => ({ ...current, [candidate.id]: action }));
          const resetTimer = window.setTimeout(() => {
            resetTimers.delete(resetTimer);
            active.delete(candidate.id);
            setActions((current) => {
              if (!(candidate.id in current)) return current;
              const next = { ...current };
              delete next[candidate.id];
              return next;
            });
          }, actionDuration(action));
          resetTimers.add(resetTimer);
        });
        round += 1;
        schedule(4_800 + (stableSeed(`${signature}:${round}`) % 3_800));
      }, delay);
    };

    schedule(3_800 + (stableSeed(signature) % 3_200));
    return () => {
      if (scheduleTimer !== undefined) window.clearTimeout(scheduleTimer);
      resetTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [paused, signature]);

  return actions;
};
