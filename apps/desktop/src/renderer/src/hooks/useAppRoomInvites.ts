import { useRef } from "react";
import { isPrivateRoomId, normalizeRelayServerUrl } from "@private-voice/shared";
import { useRoomDeepLink } from "../features/room/useRoomDeepLink";
import { privateRoomErrorMessage } from "../features/room/privateRoomMessages";
import { useAppStore } from "../store/appStore";
import { useAccountStore } from "../store/accountStore";
import { useSettingsStore } from "../store/settingsStore";
import { useRoomStore } from "../store/roomStore";

/** One app-level consumer; login and bootstrap never discard the pending invite. */
export const useAppRoomInvites = (): void => {
  const ready = useAppStore((state) => state.bootstrapPhase === "ready");
  const signedIn = useAccountStore((state) => state.snapshot.status === "signed_in");
  const hydrated = useSettingsStore((state) => !state.isHydrating && Boolean(state.settings));
  const generation = useRef(0);
  useRoomDeepLink({
    enabled: ready && signedIn && hydrated,
    onInvite: async (invite) => {
      const current = ++generation.current;
      if (!isPrivateRoomId(invite.channelId)) throw new Error("room_not_found");
      const settings = useSettingsStore.getState();
      if (invite.serverUrl) {
        const serverUrl = normalizeRelayServerUrl(invite.serverUrl);
        if (!serverUrl) throw new Error("room_invalid_request");
        // An existing call must not have its server changed under its owner.
        const app = useAppStore.getState();
        const inRoom =
          app.currentPage === "room" ||
          (app.currentPage === "settings" && app.settingsReturnTo === "room");
        if (inRoom && serverUrl !== normalizeRelayServerUrl(settings.settings?.relayServerUrl))
          throw new Error("room_invite_other_server");
        if (settings.settings?.relayServerUrl !== serverUrl)
          await settings.saveSettings({ relayServerUrl: serverUrl });
      }
      if (generation.current !== current) return;
      const app = useAppStore.getState();
      if (
        invite.autoJoin &&
        useRoomStore.getState().room.roomId === invite.channelId &&
        (app.currentPage === "room" ||
          (app.currentPage === "settings" && app.settingsReturnTo === "room"))
      ) {
        app.navigate("room");
        app.pushToast({ tone: "neutral", title: "你已在这个房间里" });
        return;
      }
      app.setPendingRoomInvite(invite.channelId, invite.autoJoin);
      app.navigate(
        app.currentPage === "room" ||
          (app.currentPage === "settings" && app.settingsReturnTo === "room")
          ? "room"
          : "home",
      );
    },
    onError: (error) =>
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "邀请暂时无法打开",
        description:
          error instanceof Error && error.message === "room_invite_other_server"
            ? "这个邀请来自另一台服务器，请先退出当前房间再打开。"
            : privateRoomErrorMessage(error),
      }),
  });
};
