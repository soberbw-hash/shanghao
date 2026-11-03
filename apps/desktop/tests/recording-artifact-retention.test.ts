import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { removeOwnedRecordingArtifacts } from "../src/main/recording-artifact-retention";
test("expiry removes only identity-owned completed artifacts and refuses junctions or malformed identity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "tracks", "recordings", "recording-id");
  const unrelated = path.join(root, "unrelated");
  await mkdir(directory, { recursive: true });
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, "keep"), "untouched");
  const manifest = path.join(directory, "manifest.json");
  await writeFile(manifest, "{invalid");
  await assert.rejects(removeOwnedRecordingArtifacts(directory, "recording-id"));
  await writeFile(manifest, JSON.stringify({ schemaVersion: 1, recordingId: "other-id" }));
  await assert.rejects(
    removeOwnedRecordingArtifacts(directory, "recording-id"),
    /identity_conflict/,
  );
  await writeFile(manifest, JSON.stringify({ schemaVersion: 1, recordingId: "recording-id" }));
  await removeOwnedRecordingArtifacts(directory, "recording-id");
  await symlink(unrelated, directory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(removeOwnedRecordingArtifacts(directory, "recording-id"), /path_invalid/);
  assert.equal(await readFile(path.join(unrelated, "keep"), "utf8"), "untouched");
});
