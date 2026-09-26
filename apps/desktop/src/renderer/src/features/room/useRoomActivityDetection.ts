import { useEffect, type RefObject } from "react";

import {
  type GameDetectionSnapshot,
  type MemberActivity,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";

import { useRoomStore } from "../../store/roomStore";

type MoveLocalMember = (
  zone: SceneZoneId,
  activity: MemberActivity,
  gameName?: string,
  musicActivity?: RoomMember["musicActivity"],
  gameIconDataUrl?: string,
) => void;

interface ActivityDetectionRefs {
  hasSnapshot: RefObject<boolean>;
  gameName: RefObject<string | undefined>;
  gameIcon: RefObject<string | undefined>;
  music: RefObject<GameDetectionSnapshot["musicActivity"] | undefined>;
  moveLocalMember: RefObject<MoveLocalMember>;
}

/** Keep the room scene synchronized with the single main-process game detector. */
export const useRoomActivityDetection = (refs: ActivityDetectionRefs): void => {
  useEffect(() => {
    const applyGameDetection = (snapshot: GameDetectionSnapshot) => {
      refs.hasSnapshot.current = true;
      const previousGame = refs.gameName.current;
      refs.gameName.current = snapshot.gameName;
      refs.gameIcon.current = snapshot.gameIconDataUrl;
      refs.music.current = snapshot.musicActivity;
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      const currentZone = localMember?.sceneZone ?? "gameDesk1";

      if (snapshot.gameName) {
        if (currentZone === "restroomZone") {
          refs.moveLocalMember.current(
            "restroomZone",
            "restroom",
            snapshot.gameName,
            snapshot.musicActivity,
            snapshot.gameIconDataUrl,
          );
        } else {
          const gameZone = currentZone.startsWith("gameDesk") ? currentZone : "gameDesk1";
          refs.moveLocalMember.current(
            gameZone,
            "gaming",
            snapshot.gameName,
            snapshot.musicActivity,
            snapshot.gameIconDataUrl,
          );
        }
      } else if (previousGame) {
        refs.moveLocalMember.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : "idle",
          undefined,
          snapshot.musicActivity,
          undefined,
        );
      } else {
        refs.moveLocalMember.current(
          currentZone,
          currentZone === "restroomZone" ? "restroom" : (localMember?.activity ?? "idle"),
          undefined,
          snapshot.musicActivity,
          undefined,
        );
      }
    };

    let liveUpdateSeen = false;
    let disposed = false;
    const unsubscribe = window.desktopApi.games.onDetected((snapshot) => {
      if (disposed) return;
      liveUpdateSeen = true;
      applyGameDetection(snapshot);
    });
    void window.desktopApi.games
      .getSnapshot()
      .then((snapshot) => {
        // A newer pushed update wins over a stale IPC snapshot.
        if (!disposed && !liveUpdateSeen) applyGameDetection(snapshot);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [refs.gameIcon, refs.gameName, refs.hasSnapshot, refs.moveLocalMember, refs.music]);
};
