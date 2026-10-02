import { useCallback, useEffect, useState, type RefObject } from "react";
import type { PrivateRoomHistory, PrivateRoomInfo } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { privateRoomErrorMessage } from "./privateRoomMessages";

import {
  cacheRoomDirectory,
  mergeHistory,
  seed,
  type DirectorySnapshot,
} from "./privateRoomDirectoryCache";
export { rememberRoomDirectory } from "./privateRoomDirectoryCache";

export const usePrivateRoomDirectory = (
  userId: string | undefined,
  serverUrl: string | undefined,
  generation: RefObject<number>,
  currentRoom?: PrivateRoomInfo,
) => {
  const scope = JSON.stringify([userId, serverUrl]);
  const [snapshot, setSnapshot] = useState(() => seed(scope, currentRoom));
  const visible = snapshot.scope === scope ? snapshot : seed(scope, currentRoom);
  useEffect(() => {
    const counter = generation;
    const owner = ++counter.current;
    setSnapshot(seed(scope, currentRoom));
    const update = (apply: (saved: DirectorySnapshot) => DirectorySnapshot) => {
      if (counter.current !== owner) return;
      setSnapshot((saved) => (saved.scope === scope ? apply(saved) : saved));
    };
    // Local history is usable immediately; the server request must not block it.
    void shanghaoCore.rooms.history().then(
      (history) =>
        update((saved) => ({
          ...saved,
          history: mergeHistory(history, saved.mine, currentRoom),
          loading: false,
        })),
      (error) =>
        update((saved) => ({ ...saved, loading: false, error: privateRoomErrorMessage(error) })),
    );
    void shanghaoCore.rooms.mine().then(
      (mine) =>
        update((saved) => ({
          ...saved,
          mine,
          history: mergeHistory(saved.history, mine, currentRoom),
        })),
      (error) => update((saved) => ({ ...saved, error: privateRoomErrorMessage(error) })),
    );
    return () => {
      counter.current++;
    };
  }, [scope, currentRoom, generation]);
  useEffect(() => {
    if (snapshot.scope === scope && !snapshot.loading) cacheRoomDirectory(snapshot);
  }, [snapshot, scope]);
  const setHistory = useCallback(
    (value: PrivateRoomHistory | ((saved: PrivateRoomHistory) => PrivateRoomHistory)) => {
      setSnapshot((saved) =>
        saved.scope === scope
          ? { ...saved, history: typeof value === "function" ? value(saved.history) : value }
          : saved,
      );
    },
    [scope],
  );
  const setMine = useCallback(
    (value: PrivateRoomInfo[] | ((saved: PrivateRoomInfo[]) => PrivateRoomInfo[])) => {
      setSnapshot((saved) =>
        saved.scope === scope
          ? { ...saved, mine: typeof value === "function" ? value(saved.mine) : value }
          : saved,
      );
    },
    [scope],
  );
  return { ...visible, setHistory, setMine };
};
