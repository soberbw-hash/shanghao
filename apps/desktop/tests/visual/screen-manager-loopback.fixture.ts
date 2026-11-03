import { ScreenShareManager } from "../../src/renderer/src/features/screen-share/ScreenShareManager";

const gather = async (peer: RTCPeerConnection) => {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      peer.removeEventListener("icegatheringstatechange", update);
      reject(Error("ice_timeout"));
    }, 5000);
    const update = () => {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", update);
        resolve();
      }
    };
    peer.addEventListener("icegatheringstatechange", update);
  });
};
Object.assign(window, {
  runScreenManagerLoopback: async () => {
    let sender: RTCPeerConnection | undefined;
    let receiver: RTCPeerConnection | undefined;
    let received: MediaStream | undefined;
    const manager = new ScreenShareManager({
      startPublishing: async (stream, profile) => {
        received = undefined;
        sender = new RTCPeerConnection({ iceServers: [] });
        receiver = new RTCPeerConnection({ iceServers: [] });
        receiver.ontrack = (event) => {
          received = new MediaStream([event.track]);
        };
        for (const track of stream.getTracks()) {
          const output = sender.addTrack(track, stream);
          const parameters = output.getParameters();
          parameters.encodings = [
            { maxBitrate: profile.maxBitrate, maxFramerate: profile.maxFramerate },
          ];
          await output.setParameters(parameters);
        }
        await sender.setLocalDescription(await sender.createOffer());
        await gather(sender);
        await receiver.setRemoteDescription(sender.localDescription!);
        await receiver.setLocalDescription(await receiver.createAnswer());
        await gather(receiver);
        await sender.setRemoteDescription(receiver.localDescription!);
      },
      stopPublishing: async () => {
        sender?.close();
        receiver?.close();
      },
    });
    const video = document.createElement("video");
    video.muted = true;
    try {
      const source = (await manager.openSourcePicker()).find((s) => s.kind === "screen");
      if (!source) throw Error("screen_source_missing");
      const captures = [];
      // Reuse the actual manager and service, including content protection and stop cleanup.
      // A new-process-only capture does not catch stale native ownership on the next share.
      for (const quality of ["720p", "1080p", "1440p"] as const) {
        const local = await manager.startShare({
          sourceId: source.id,
          quality,
          includeSystemAudio: false,
        });
        if (!received) throw Error("remote_track_missing");
        video.srcObject = received;
        await video.play();
        const frame = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("remote_frame_timeout")), 7000);
          video.requestVideoFrameCallback((_now, metadata) => {
            clearTimeout(timer);
            resolve({ width: metadata.width, height: metadata.height });
          });
        });
        const stats = await receiver!.getStats();
        const decoded = [...stats.values()]
          .filter((s) => s.type === "inbound-rtp" && s.kind === "video")
          .reduce((sum, s) => sum + (s.framesDecoded ?? 0), 0);
        if (!decoded || !frame.width || !frame.height) throw Error("remote_decode_missing");
        await manager.stopShare();
        captures.push({
          quality,
          frame,
          framesDecoded: decoded,
          stopped:
            manager.getSnapshot().status === "idle" &&
            local.getTracks().every((t) => t.readyState === "ended"),
        });
        video.pause();
        video.srcObject = null;
      }
      return {
        ok: captures.every((capture) => capture.stopped && capture.framesDecoded > 0),
        captures,
        capture: "production-manager-and-main-service",
        transport: "same-machine-native-webrtc",
      };
    } finally {
      await manager.stopShare();
      manager.destroy();
      sender?.close();
      receiver?.close();
      video.pause();
      video.srcObject = null;
    }
  },
});
