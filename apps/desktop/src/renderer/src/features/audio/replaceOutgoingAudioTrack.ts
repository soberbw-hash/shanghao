import { writeRendererLog } from "../../utils/logger";

/** Commit only after all destinations accept the track; preserve the previous
 * live stream on failure, including senders that settle later than the failure. */
export async function replaceOutgoingAudioTrack(
  track: MediaStreamTrack,
  previousStream: MediaStream,
  peers: Iterable<{ replaceLocalTrack(track: MediaStreamTrack): Promise<void> }>,
  fallback?: { replaceLocalStream(stream: MediaStream): Promise<void> },
): Promise<MediaStream> {
  const nextStream = new MediaStream([track]);
  const previousTrack = previousStream.getAudioTracks()[0];
  const destinations = [...peers];
  const replacements = await Promise.allSettled(
    destinations.map((peer) => peer.replaceLocalTrack(track)),
  );
  try {
    const failed = replacements.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    await fallback?.replaceLocalStream(nextStream);
    return nextStream;
  } catch (error) {
    if (previousTrack?.readyState === "live") {
      const restored = await Promise.allSettled([
        ...destinations.map((peer) => peer.replaceLocalTrack(previousTrack)),
        fallback?.replaceLocalStream(previousStream),
      ]);
      const failedRestores = restored.filter((result) => result.status === "rejected").length;
      if (failedRestores) {
        void writeRendererLog("audio", "warn", "Input track rollback incomplete", {
          failedRestores,
        });
      }
    }
    throw error;
  }
}
