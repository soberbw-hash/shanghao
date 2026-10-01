import { useEffect, useRef } from "react";

import type { DeepLinkInvite } from "@private-voice/shared";

export const useRoomDeepLink = ({
  onInvite,
  onError,
  enabled = true,
}: {
  onInvite: (invite: DeepLinkInvite) => Promise<void>;
  onError: (error: unknown) => void;
  enabled?: boolean;
}): void => {
  const onInviteRef = useRef(onInvite);
  const onErrorRef = useRef(onError);
  const enabledRef = useRef(enabled);
  const queued = useRef<DeepLinkInvite | undefined>(undefined);
  const lastDelivery = useRef({ key: "", at: 0 });
  onInviteRef.current = onInvite;
  onErrorRef.current = onError;
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    const openInvite = async (invite: DeepLinkInvite) => {
      if (!enabledRef.current) {
        queued.current = invite;
        return;
      }
      // Initial consumption and the native event can describe the same click.
      // Keep delivery across StrictMode's effect cleanup without joining twice.
      const key = JSON.stringify(invite);
      if (lastDelivery.current.key === key && Date.now() - lastDelivery.current.at < 1000) return;
      lastDelivery.current = { key, at: Date.now() };
      try {
        await onInviteRef.current(invite);
      } catch (error) {
        if (enabledRef.current) onErrorRef.current(error);
      }
    };

    const onDeepLink = window.desktopApi?.app?.onDeepLink;
    const consumeDeepLink = window.desktopApi?.app?.consumeDeepLink;
    if (typeof onDeepLink !== "function" || typeof consumeDeepLink !== "function") {
      return;
    }

    const unsubscribe = onDeepLink((invite) => {
      void openInvite(invite);
      void consumeDeepLink()
        .catch(() => undefined)
        .then((pending) => {
          if (pending) void openInvite(pending);
        });
    });
    if (queued.current) {
      const invite = queued.current;
      queued.current = undefined;
      void openInvite(invite);
    }
    void consumeDeepLink()
      .then((invite) => {
        if (invite) void openInvite(invite);
      })
      .catch(() => undefined);

    return () => {
      unsubscribe();
    };
  }, [enabled]);
};
