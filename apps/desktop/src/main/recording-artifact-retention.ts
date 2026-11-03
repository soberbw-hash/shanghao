import { lstat, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { platformService } from "./platform/PlatformService";

/** Only a completed, identity-owned track directory may expire; junctions never widen scope. */
export async function removeOwnedRecordingArtifacts(
  directory: string,
  recordingId: string,
): Promise<void> {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("recording_artifact_path_invalid");
  const root = await realpath(path.dirname(path.dirname(directory)));
  const expected = path.join(root, "recordings", path.basename(directory));
  const resolved = await realpath(directory);
  const key = (value: string) => (platformService.isWindows ? value.toLowerCase() : value);
  if (key(resolved) !== key(expected)) throw Error("recording_artifact_path_invalid");
  const manifest = path.join(directory, "manifest.json");
  const metadata = await lstat(manifest);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024)
    throw Error("recording_artifact_manifest_invalid");
  const value = JSON.parse(await readFile(manifest, "utf8")) as {
    schemaVersion?: unknown;
    recordingId?: unknown;
  };
  if (value.schemaVersion !== 1 || value.recordingId !== recordingId)
    throw Error("recording_artifact_identity_conflict");
  await rm(expected, { recursive: true, force: true });
}
