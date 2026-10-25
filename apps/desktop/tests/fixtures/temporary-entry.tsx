import { createRoot } from "react-dom/client";
import type {
  DesktopApi,
  TemporaryRoomDescriptor,
  TemporaryRoomProfile,
} from "@private-voice/shared";
import { TemporaryRoomEntry } from "../../src/renderer/src/components/room/TemporaryRoomEntry";
import { useAppStore } from "../../src/renderer/src/store/appStore";
import { useAccountStore } from "../../src/renderer/src/store/accountStore";
import "../../src/renderer/src/styles/index.css";

const evidence = {
  saved: undefined as TemporaryRoomProfile | undefined,
  createdArgs: [] as unknown[],
  created: 0,
  joined: "",
  prepared: 0,
};
const oldAvatar =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lR8AAAAASUVORK5CYII=";
const signed = location.search.includes("signed=1");
if (signed)
  useAccountStore.setState({
    snapshot: {
      status: "signed_in",
      configured: true,
      guestAllowed: false,
      profile: {
        userId: "fixture",
        username: "fixture",
        displayName: "账号朋友",
        accountAvatarPresetId: "sky-cat",
      },
    } as never,
  });
Object.assign(window, { temporaryEntryEvidence: evidence });
window.desktopApi = {
  temporaryRooms: {
    getProfile: async () => ({ nickname: "临时朋友", avatarId: "corgi", avatarDataUrl: oldAvatar }),
    saveProfile: async (profile: TemporaryRoomProfile) => {
      evidence.saved = profile;
      return profile;
    },
    prepareAvatar: async (image: string) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (!image.startsWith("data:image/png;base64,"))
        throw Error("fixture expects normalized PNG");
      evidence.prepared++;
      return image;
    },
    create: async (...args: unknown[]) => {
      evidence.created++;
      evidence.createdArgs = args;
      return { contextId: "fixture-create", room: { code: "03918274" } } as TemporaryRoomDescriptor;
    },
    join: async (code: string) => {
      evidence.joined = code;
      return { contextId: "fixture-join", room: { code } } as TemporaryRoomDescriptor;
    },
    release: async () => undefined,
  },
} as unknown as DesktopApi;
createRoot(document.getElementById("root")!).render(
  <main
    style={{
      padding: 20,
      width: "100%",
      maxWidth: 460,
      margin: "20px auto",
      background: "#f8fcff",
    }}
  >
    <h1>上号 · 临时联机测试</h1>
    <TemporaryRoomEntry
      onJoin={async () => {
        useAppStore.setState({ currentPage: "room" });
      }}
    />
  </main>,
);
