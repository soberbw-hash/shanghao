import { useEffect, useRef, useState } from "react";
import type { LocalChronicleEntry, RoomChronicleDay } from "@private-voice/shared";
import { useAccountStore } from "../../store/accountStore";
import { useSettingsStore } from "../../store/settingsStore";

export function useChronicleArchive(
  roomId: string,
  incoming: LocalChronicleEntry[],
  serverDay?: RoomChronicleDay,
) {
  const account = useAccountStore((state) => state.snapshot.profile?.userId);
  const server = useSettingsStore((state) => state.settings?.relayServerUrl);
  const scope = JSON.stringify([account, server, roomId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [saved, setSaved] = useState<{ scope: string; entries: LocalChronicleEntry[] }>();
  const [failure, setFailure] = useState<{ scope: string; text: string }>();
  const api = window.desktopApi?.chronicleArchive;
  useEffect(() => {
    let active = true;
    if (!api || !account || serverDay) return;
    void api
      .append(roomId, incoming)
      .then((entries) => {
        if (active) {
          setSaved({ scope, entries });
          setFailure(undefined);
        }
      })
      .catch(() => {
        if (active) setFailure({ scope, text: "本机保存暂未完成，当前纪事仍可查看" });
      });
    return () => {
      active = false;
    };
  }, [api, account, roomId, scope, incoming, serverDay]);
  const retained = !serverDay && saved?.scope === scope ? saved.entries : [];
  const reactions = new Map(retained.map((entry) => [entry.id, entry.reaction]));
  const entries =
    serverDay?.entries ??
    [
      ...new Map(
        [...retained, ...incoming].map((entry) => [
          entry.id,
          { ...entry, reaction: reactions.get(entry.id) },
        ]),
      ).values(),
    ].sort((a, b) => a.at - b.at);
  const react = async (id: string, reaction: LocalChronicleEntry["reaction"]) => {
    if (!api) return;
    try {
      const entries = await api.react(roomId, id, reaction);
      if (currentScope.current !== scope) return;
      setSaved({ scope, entries });
    } catch {
      setFailure({ scope, text: "这次评价没有保存，请稍后重试" });
    }
  };
  const exportStories = async () => {
    if (!api) return;
    try {
      await api.export(roomId, serverDay);
    } catch {
      if (currentScope.current === scope)
        setFailure({ scope, text: "导出未完成；请选择新的文件名，原纪事仍保留" });
    }
  };
  return {
    entries,
    react,
    exportStories,
    available: !!api && !!account,
    stored: serverDay ? !!api && !!account : !!saved && saved.scope === scope,
    error: failure?.scope === scope ? failure.text : "",
  };
}
