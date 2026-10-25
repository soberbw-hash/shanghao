import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import type { ApplicationAudioSession, ApplicationAudioSource } from "@private-voice/shared";
import { musicApplicationName } from "@private-voice/shared";
import { ApplicationAudioPlayer } from "../../features/audio/ApplicationAudioPlayer";
import { useRoomStore } from "../../store/roomStore";
import { Button } from "../base/Button";
import { ApplicationAudioPicker, applicationAudioSourceName } from "./ApplicationAudioPicker";

const errorMessage = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (/unsupported_os/.test(code)) return "当前 Windows 版本不支持放歌。";
  if (/source_exited|source_missing|source_identity_changed/.test(code))
    return "音乐应用已关闭或重启，请刷新后重选。";
  if (/room_not_connected/.test(code)) return "连接恢复后才能放歌。";
  return "放歌未能开启，请确认音乐应用正在播放后重试。";
};
export function ApplicationAudioControl({
  onTrack,
  disabled,
}: {
  onTrack: (track?: MediaStreamTrack, sourceName?: string) => Promise<void>;
  disabled?: boolean;
}) {
  const roomId = useRoomStore((state) => state.room.roomId);
  const trigger = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<ApplicationAudioSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState<{ session: ApplicationAudioSession; name: string }>();
  const [gain, setGain] = useState(0.72);
  const generation = useRef(0);
  const listing = useRef(0);
  const active = useRef<
    { player: ApplicationAudioPlayer; session?: ApplicationAudioSession } | undefined
  >(undefined);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);
  const stop = async () => {
    generation.current++;
    const old = active.current;
    active.current = undefined;
    try {
      if (old?.session) await window.desktopApi.applicationAudio.stop(old.session.sessionId);
      else if (old) await window.desktopApi.applicationAudio.stop();
      if (old && useRoomStore.getState().room.roomId === roomId) await onTrack(undefined);
    } catch {
      /* Source failure must still release the local graph. */
    } finally {
      old?.player.dispose();
      setSharing(undefined);
      setBusy(false);
    }
  };
  stopRef.current = stop;
  useEffect(() => {
    const pendingListings = listing;
    const unsubscribePcm = window.desktopApi.applicationAudio.onFrame((frame) => {
      try {
        if (active.current?.session?.sessionId === frame.sessionId)
          active.current.player.push(frame);
      } finally {
        window.desktopApi.applicationAudio.acknowledge(frame.sessionId, frame.sequence);
      }
    });
    const unsubscribeState = window.desktopApi.applicationAudio.onState((state) => {
      if (
        state.sessionId !== active.current?.session?.sessionId ||
        !["error", "stopped"].includes(state.phase)
      )
        return;
      if (state.phase === "error") setError(errorMessage(state.code));
      void stopRef.current();
    });
    return () => {
      pendingListings.current++;
      unsubscribePcm();
      unsubscribeState();
      void stopRef.current();
    };
  }, []);
  const refresh = async () => {
    const mine = ++listing.current;
    setLoading(true);
    setError("");
    try {
      const result = await window.desktopApi.applicationAudio.listSources();
      if (listing.current !== mine) return;
      if (!result.supported) throw Error("unsupported_os");
      setSources(result.sources.filter((source) => musicApplicationName(source.processName)));
      setSourceId("");
    } catch (cause) {
      if (listing.current === mine) setError(errorMessage(cause));
    } finally {
      if (listing.current === mine) setLoading(false);
    }
  };
  const start = async () => {
    if (!sourceId || busy || active.current) return;
    const mine = ++generation.current;
    setBusy(true);
    setError("");
    const player = new ApplicationAudioPlayer();
    const owner = { player, session: undefined as ApplicationAudioSession | undefined };
    active.current = owner;
    try {
      const track = await player.prepare();
      if (generation.current !== mine) return;
      owner.session = await window.desktopApi.applicationAudio.start(sourceId);
      if (generation.current !== mine) {
        await window.desktopApi.applicationAudio.stop(owner.session.sessionId);
        return;
      }
      await onTrack(
        track,
        applicationAudioSourceName(sources.find((source) => source.id === sourceId)),
      );
      if (generation.current !== mine) return;
      setSharing({
        session: owner.session,
        name: applicationAudioSourceName(sources.find((source) => source.id === sourceId)),
      });
      setGain(owner.session.gain);
      setOpen(false);
    } catch (cause) {
      if (generation.current === mine) {
        setError(errorMessage(cause));
        await stop();
      }
    } finally {
      if (generation.current === mine) setBusy(false);
      if (active.current !== owner) player.dispose();
    }
  };
  return (
    <div className="application-audio-control" ref={trigger}>
      <Button
        variant={sharing ? "secondary" : "ghost"}
        className="voice-action-button-with-text"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          if (!open && !sharing) void refresh();
        }}
      >
        <Music2 size={16} />
        <span className="voice-action-label">{sharing ? "放歌中" : "放歌"}</span>
      </Button>
      <ApplicationAudioPicker
        open={open}
        sources={sources}
        selectedId={sourceId}
        loading={loading}
        busy={busy}
        error={error}
        sharingName={sharing?.name}
        gain={gain}
        onSelect={setSourceId}
        onRefresh={() => void refresh()}
        onStart={() => void start()}
        onStop={() => void stop()}
        onClose={() => setOpen(false)}
        returnFocus={() => trigger.current?.querySelector("button")?.focus()}
        onGain={(value) => {
          setGain(value);
          active.current?.player.setGain(value);
          if (sharing)
            void window.desktopApi.applicationAudio
              .setGain(sharing.session.sessionId, value)
              .catch(() => undefined);
        }}
      />
    </div>
  );
}
