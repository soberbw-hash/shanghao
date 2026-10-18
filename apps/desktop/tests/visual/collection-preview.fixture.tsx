import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { RoomCollectionItem } from "@private-voice/shared";
import { CollectionDialog } from "../../src/renderer/src/components/room/RoomOverlays";
import cover from "../../src/renderer/src/assets/games/screens/league-of-legends.webp";
import "../../src/renderer/src/styles/index.css";

window.desktopApi = {
  app: {
    getChatLinkPreview: async (url: string) => {
      if (url.endsWith("/offline")) throw new Error("offline");
      if (url.endsWith("/missing-image"))
        return { title: "封面失效的网页", imageDataUrl: "data:image/png;base64,broken" };
      return {
        title: "英雄联盟 · 和搭子一起开启新一局",
        description: "阵容思路、游戏指南和一起开黑的约定，收藏后随时回来查看。",
        siteName: "游戏资料站",
        imageDataUrl: cover,
        imageKind: "cover",
      };
    },
  },
} as unknown as typeof window.desktopApi;
const seed: RoomCollectionItem[] = [
  { id: "text", kind: "text", title: "今晚的约定", content: "晚上八点，老地方见。" },
  {
    id: "broken",
    kind: "link",
    title: "封面失效的网页",
    content: "https://example.com/missing-image",
  },
  { id: "offline", kind: "link", title: "稍后再看的链接", content: "https://example.com/offline" },
  { id: "cover", kind: "link", title: "example.com", content: "https://example.com/game-guide" },
].map(
  (item) =>
    ({
      ...item,
      createdByNickname: "游戏搭子",
      createdByPeerId: "fixture",
      createdAt: "2026-10-18T00:00:00Z",
    }) as RoomCollectionItem,
);
const Fixture = () => {
  const [items, setItems] = useState(seed);
  const [draft, setDraft] = useState("");
  const [event, setEvent] = useState("");
  const [open, setOpen] = useState(true);
  return (
    <main className="room-page" style={{ height: "100vh" }}>
      <output id="fixture-event">{event}</output>
      <CollectionDialog
        isOpen={open}
        reduceMotion
        draft={draft}
        isSaving={false}
        items={items}
        onDraftChange={setDraft}
        onSave={() => setEvent("save")}
        onOpenItem={(url) => setEvent(`open:${url}`)}
        onCopyItem={(url) => setEvent(`copy:${url}`)}
        onRemoveItem={(id) => setItems((current) => current.filter((item) => item.id !== id))}
        onClose={() => setOpen(false)}
      />
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Fixture />);
