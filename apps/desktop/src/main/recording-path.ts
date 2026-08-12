import path from "node:path";

export const RECORDING_DIRECTORY_NAME = "上号录音";
const INVALID_WINDOWS_FILE_NAME_CHARACTERS = new Set([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

export const resolveRecordingDirectory = (
  configuredDirectory: string | undefined,
  documentsDirectory: string,
): string => {
  const candidate = configuredDirectory?.trim();
  return candidate && path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.join(documentsDirectory, RECORDING_DIRECTORY_NAME);
};

export const sanitizeRecordingFileName = (suggestedFileName: string): string => {
  const baseName = path
    .basename(suggestedFileName || "上号录音.m4a")
    .split("")
    .map((character) =>
      character.charCodeAt(0) <= 31 || INVALID_WINDOWS_FILE_NAME_CHARACTERS.has(character)
        ? "-"
        : character,
    )
    .join("")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  const withoutExtension = baseName.replace(/\.m4a$/i, "") || "上号录音";
  return `${withoutExtension}.m4a`;
};

export const resolveAvailableRecordingPath = async (
  directory: string,
  suggestedFileName: string,
  pathExists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  const safeFileName = sanitizeRecordingFileName(suggestedFileName);
  const extension = path.extname(safeFileName);
  const stem = path.basename(safeFileName, extension);

  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidate = path.join(
      directory,
      suffix === 0 ? safeFileName : `${stem} (${suffix + 1})${extension}`,
    );
    if (!(await pathExists(candidate))) return candidate;
  }

  return path.join(directory, `${stem}-${Date.now()}${extension}`);
};
