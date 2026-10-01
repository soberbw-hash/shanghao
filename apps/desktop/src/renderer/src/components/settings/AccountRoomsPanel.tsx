import { useEffect, useRef, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import type { PrivateRoomInfo } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { useSettingsStore } from "../../store/settingsStore";
import { useRoomStore } from "../../store/roomStore";
import { Button } from "../base/Button";
import { PrivateRoomIcon } from "../room/PrivateRoomIcon";
import { roomIconStyle } from "../room/roomIconColors";
import { RoomManagementDialog } from "../room/RoomManagementDialog";
/** Account-scoped directory; the current room store remains the live member source. */
export const AccountRoomsPanel = ({ userId }: { userId: string }) => {
  const serverUrl = useSettingsStore((state) => state.settings?.relayServerUrl);
  const activeRoom = useRoomStore((state) => state.room);
  const [rooms, setRooms] = useState<PrivateRoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [managedId, setManagedId] = useState<string>();
  const scope = `${serverUrl}|${userId}`;
  const [loadedScope, setLoadedScope] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const counter = generation;
    const owner = ++counter.current;
    setLoading(true);
    setError("");
    void shanghaoCore.rooms
      .mine()
      .then((result) => {
        if (counter.current === owner) {
          setRooms(result.filter((room) => room.ownerId === userId));
          setLoadedScope(scope);
        }
      })
      .catch((error) => {
        if (counter.current === owner) setError(privateRoomErrorMessage(error));
      })
      .finally(() => {
        if (counter.current === owner) setLoading(false);
      });
    return () => {
      counter.current++;
    };
  }, [scope, userId, revision]);
  const visibleRooms = loadedScope === scope ? rooms : [];
  const managed = visibleRooms.find((room) => room.roomId === managedId);
  const isActive = Boolean(managed && managed.roomId === activeRoom.roomId);
  return (
    <section
      className="account-rooms-panel"
      aria-labelledby="account-rooms-title"
      aria-busy={loading}
    >
      <header className="account-rooms-heading">
        <div>
          <h3 id="account-rooms-title">我的房间</h3>
          <p>管理你创建的房间</p>
        </div>
        <Button
          variant="ghost"
          className="account-room-action"
          disabled={loading}
          aria-label="刷新我的房间"
          title="刷新"
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </Button>
      </header>
      {error && (
        <p className="account-rooms-error" role="alert">
          {error}
        </p>
      )}
      {loading && !visibleRooms.length ? (
        <p role="status" className="account-rooms-empty">
          正在加载房间…
        </p>
      ) : visibleRooms.length ? (
        <div className="account-rooms-list">
          {visibleRooms.map((room) => (
            <div className="account-room-row" key={room.roomId}>
              <span className="account-room-icon" style={roomIconStyle(room.iconColor)}>
                <PrivateRoomIcon icon={room.icon} />
              </span>
              <div className="account-room-copy">
                <strong title={room.name}>{room.name}</strong>
                <span>
                  频道 {room.channelCode} · {room.onlineCount}/{room.capacity} 在线
                </span>
              </div>
              <Button
                variant="ghost"
                className="account-room-action"
                disabled={loading}
                aria-label={`管理房间：${room.name}`}
                onClick={() => setManagedId(room.roomId)}
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
                <span>管理</span>
              </Button>
            </div>
          ))}
        </div>
      ) : (
        !error && <p className="account-rooms-empty">还没有创建房间，可从切换房间中创建。</p>
      )}
      {managed && (
        <RoomManagementDialog
          key={`${scope}|${managed.roomId}`}
          room={isActive ? (activeRoom.privateRoom ?? managed) : managed}
          members={isActive ? activeRoom.members.filter((member) => !member.isEmptySlot) : []}
          onClose={() => {
            setManagedId(undefined);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </section>
  );
};
