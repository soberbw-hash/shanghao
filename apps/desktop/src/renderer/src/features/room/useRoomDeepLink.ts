import { useEffect, useRef } from "react";

import type { ChannelId } from "../chat/chatPersistence";

interface RoomInvite {
  channelId: ChannelId;
  serverUrl: string;
}

export const useRoomDeepLink = ({
  onInvite,
  onError,
}: {
  onInvite: (invite: RoomInvite) => Promise<void>;
  onError: (error: unknown) => void;
}): void => {
  const onInviteRef = useRef(onInvite);
  const onErrorRef = useRef(onError);
  onInviteRef.current = onInvite;
  onErrorRef.current = onError;

  useEffect(() => {
    let isDisposed = false;
    const openInvite = async (invite: RoomInvite) => {
      if (isDisposed) return;
      try {
        await onInviteRef.current(invite);
      } catch (error) {
        if (!isDisposed) onErrorRef.current(error);
      }
    };

    const onDeepLink = window.desktopApi?.app?.onDeepLink;
    const consumeDeepLink = window.desktopApi?.app?.consumeDeepLink;
    if (typeof onDeepLink !== "function" || typeof consumeDeepLink !== "function") {
      return () => {
        isDisposed = true;
      };
    }

    const unsubscribe = onDeepLink((invite) => {
      void consumeDeepLink()
        .catch(() => undefined)
        .finally(() => void openInvite(invite));
    });
    void consumeDeepLink()
      .then((invite) => {
        if (invite) void openInvite(invite);
      })
      .catch(() => undefined);

    return () => {
      isDisposed = true;
      unsubscribe();
    };
  }, []);
};
