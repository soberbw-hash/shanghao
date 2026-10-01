import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { requireClipDirectory } from "./recording-clip-export";

/** Native reveal/drag may access finished clips only, never arbitrary Renderer paths. */
export const requireExportedClip = async (directory: string, value: unknown): Promise<string> => {
  if (
    typeof value !== "string" ||
    value.length > 2_048 ||
    path.extname(value).toLowerCase() !== ".m4a" ||
    path.basename(value).startsWith(".")
  )
    throw new Error("clip_invalid_request");
  const clips = await requireClipDirectory(directory);
  const [file, actual] = await Promise.all([lstat(value), realpath(value)]);
  if (!file.isFile() || file.isSymbolicLink() || path.dirname(actual) !== clips)
    throw new Error("clip_invalid_request");
  return actual;
};
