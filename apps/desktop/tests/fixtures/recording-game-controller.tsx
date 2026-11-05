import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoomConnectionState, type RoomMember } from "@private-voice/shared";
import { useRecordingController } from "../../src/renderer/src/hooks/useRecordingController";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";

const context = new AudioContext();
const oscillator = context.createOscillator();
const output = context.createMediaStreamDestination();
oscillator.connect(output);
oscillator.start();
const member = {
  id: "peer-a",
  userId: "account-a",
  nickname: "A",
  isLocal: true,
  gameName: "英雄联盟",
} as RoomMember;
useRoomStore.getState().setRoom({
  roomId: "room-a",
  roomName: "fixture",
  members: [member],
  connectionState: RoomConnectionState.Connected,
});
useRoomStore.getState().setLocalStream(output.stream);

function Fixture() {
  const recording = useRecordingController();
  return (
    <>
      <button id="start" onClick={() => recording.startRecording()}>
        start
      </button>
      <button
        id="change"
        onClick={() =>
          useRoomStore
            .getState()
            .setRoom({ roomId: "room-a", members: [{ ...member, gameName: "CS2" }] })
        }
      >
        change
      </button>
      <button
        id="stop"
        onClick={() =>
          void recording
            .stopRecording()
            .then(() => {
              document.documentElement.dataset.finished = "yes";
            })
            .catch(() => {
              document.documentElement.dataset.finished = "error";
            })
        }
      >
        stop
      </button>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
